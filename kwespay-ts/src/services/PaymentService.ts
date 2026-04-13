import {
  EIP1193Provider,
  PayParams,
  PaymentResult,
  KwesPayError,
} from "../types/index.js";
import { ContractService } from "./ContractService.js";
import { resolveContractAddress } from "../internal/config.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const GAS_BUFFER = 300_000n * 2_000_000_000n;

export class PaymentService {
  private readonly contractService: ContractService;
  private readonly provider: EIP1193Provider;

  constructor(provider: EIP1193Provider) {
    this.provider = provider;
    this.contractService = new ContractService(provider);
  }

  private async ensureCorrectNetwork(
    expectedChainId: number,
    expectedNetwork: string,
    onStatus?: (title: string, detail: string) => void
  ): Promise<void> {
    const raw = (await this.provider.request({
      method: "eth_chainId",
    })) as string;
    const current = parseInt(raw, 16);

    if (current === expectedChainId) return;

    onStatus?.(
      "Switching network",
      `Switching to ${expectedNetwork} (chain ${expectedChainId})…`
    );

    try {
      await this.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + expectedChainId.toString(16) }],
      });
    } catch (switchErr: unknown) {
      const errAny = switchErr as { code?: number; message?: string };
      if (errAny?.code === 4902) {
        throw new KwesPayError(
          `Network ${expectedNetwork} (chain ${expectedChainId}) is not added to your wallet. Please add it manually and retry.`,
          "WRONG_NETWORK"
        );
      }
      const msg = errAny?.message ?? String(switchErr);
      if (
        msg.includes("rejected") ||
        msg.includes("denied") ||
        msg.includes("ACTION_REJECTED")
      ) {
        throw new KwesPayError(
          `Network switch to ${expectedNetwork} was rejected. Please switch manually and retry.`,
          "WRONG_NETWORK"
        );
      }
      throw new KwesPayError(
        `Failed to switch to ${expectedNetwork}: ${msg}`,
        "WRONG_NETWORK"
      );
    }

    const confirmedRaw = (await this.provider.request({
      method: "eth_chainId",
    })) as string;
    const confirmed = parseInt(confirmedRaw, 16);

    if (confirmed !== expectedChainId) {
      throw new KwesPayError(
        `Wallet is on chain ${confirmed} but payment requires chain ${expectedChainId} (${expectedNetwork}). Please switch your network and retry.`,
        "WRONG_NETWORK"
      );
    }
  }

  private async ensureSufficientBalance(
    walletAddress: string,
    tokenAddress: string,
    amountBaseUnits: string,
    onStatus?: (title: string, detail: string) => void
  ): Promise<void> {
    const amount = BigInt(amountBaseUnits);
    const isNative = tokenAddress === ZERO_ADDRESS;

    onStatus?.("Checking balance", "Verifying wallet balance…");

    const nativeRaw = (await this.provider.request({
      method: "eth_getBalance",
      params: [walletAddress, "latest"],
    })) as string;
    const nativeBalance =
      nativeRaw && nativeRaw !== "0x" ? BigInt(nativeRaw) : 0n;

    if (isNative) {
      const required = amount + GAS_BUFFER;
      if (nativeBalance < required) {
        throw new KwesPayError(
          `Insufficient native balance. Required ~${(
            Number(required) / 1e18
          ).toFixed(8)} ETH (payment + gas), available: ${(
            Number(nativeBalance) / 1e18
          ).toFixed(8)} ETH.`,
          "INSUFFICIENT_BALANCE"
        );
      }
      return;
    }

    if (nativeBalance < GAS_BUFFER) {
      throw new KwesPayError(
        `Insufficient gas balance. Need at least ${(
          Number(GAS_BUFFER) / 1e18
        ).toFixed(8)} ETH for gas, available: ${(
          Number(nativeBalance) / 1e18
        ).toFixed(8)} ETH.`,
        "INSUFFICIENT_BALANCE"
      );
    }

    const balanceData =
      "0x70a08231" + walletAddress.slice(2).toLowerCase().padStart(64, "0");

    const raw = (await this.provider.request({
      method: "eth_call",
      params: [{ to: tokenAddress, data: balanceData }, "latest"],
    })) as string;

    const tokenBalance = raw && raw !== "0x" ? BigInt(raw) : 0n;

    if (tokenBalance < amount) {
      throw new KwesPayError(
        `Insufficient token balance. Required: ${amount.toString()}, available: ${tokenBalance.toString()} (base units).`,
        "INSUFFICIENT_BALANCE"
      );
    }
  }

  async pay(params: PayParams): Promise<PaymentResult> {
    const { provider, payload, onStatus } = params;

    if (!payload.paymentIdBytes32 || !payload.backendSignature) {
      throw new KwesPayError(
        "Invalid transaction payload — missing paymentIdBytes32 or backendSignature",
        "TRANSACTION_FAILED"
      );
    }

    if (!payload.vendorIdentifier) {
      throw new KwesPayError(
        "Invalid transaction payload — missing vendorIdentifier",
        "TRANSACTION_FAILED"
      );
    }

    await this.ensureCorrectNetwork(payload.chainId, payload.network, onStatus);

    const accounts = (await this.provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    const walletAddress = accounts[0];

    await this.ensureSufficientBalance(
      walletAddress,
      payload.tokenAddress,
      payload.amountBaseUnits,
      onStatus
    );

    const contractAddress = resolveContractAddress(payload.network);

    await this.contractService.ensureApproval(
      payload.tokenAddress,
      payload.amountBaseUnits,
      contractAddress,
      payload.chainId,
      onStatus
    );

    const { txHash, blockNumber } = await this.contractService.createPayment(
      {
        paymentIdBytes32: payload.paymentIdBytes32,
        vendorIdentifier: payload.vendorIdentifier,
        tokenAddress: payload.tokenAddress,
        amountBaseUnits: payload.amountBaseUnits,
        backendSignature: payload.backendSignature,
        contractAddress,
        chainId: payload.chainId,
      },
      onStatus
    );

    return {
      txHash,
      blockNumber,
      transactionReference: payload.transactionReference,
      paymentIdBytes32: payload.paymentIdBytes32,
    };
  }
}
