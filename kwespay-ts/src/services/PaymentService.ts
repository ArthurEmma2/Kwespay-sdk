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
    totalBaseUnits: string,
    onStatus?: (title: string, detail: string) => void
  ): Promise<void> {
    const total = BigInt(totalBaseUnits);
    const isNative = tokenAddress === ZERO_ADDRESS;

    console.log("[KwesPay] Balance check →", {
      walletAddress,
      tokenAddress,
      totalBaseUnits,
      isNative,
    });

    onStatus?.("Checking balance", "Verifying wallet balance…");

    const nativeRaw = (await this.provider.request({
      method: "eth_getBalance",
      params: [walletAddress, "latest"],
    })) as string;
    const nativeBalance =
      nativeRaw && nativeRaw !== "0x" ? BigInt(nativeRaw) : 0n;

    console.log("[KwesPay] Native balance:", nativeBalance.toString());

    if (isNative) {
      const required = total + GAS_BUFFER;
      if (nativeBalance < required) {
        throw new KwesPayError(
          `Insufficient native balance. Required ~${(
            Number(required) / 1e18
          ).toFixed(8)} (payment + fee + gas), available: ${(
            Number(nativeBalance) / 1e18
          ).toFixed(8)}.`,
          "INSUFFICIENT_BALANCE"
        );
      }
      return;
    }

    if (nativeBalance < GAS_BUFFER) {
      throw new KwesPayError(
        `Insufficient gas balance. Need at least ${(
          Number(GAS_BUFFER) / 1e18
        ).toFixed(8)} for gas, available: ${(
          Number(nativeBalance) / 1e18
        ).toFixed(8)}.`,
        "INSUFFICIENT_BALANCE"
      );
    }

    // Guard: if the token address is the zero address (misconfigured / placeholder not yet set),
    // skip the on-chain balance check rather than reading a non-existent contract and getting 0.
    // The contract call itself will fail with a clearer error if the token is truly wrong.
    if (tokenAddress === ZERO_ADDRESS) {
      console.warn(
        "[KwesPay] Token address is zero address — skipping ERC-20 balance check. Set the correct token contract address in your config."
      );
      return;
    }

    const balanceData =
      "0x70a08231" + walletAddress.slice(2).toLowerCase().padStart(64, "0");

    const raw = (await this.provider.request({
      method: "eth_call",
      params: [{ to: tokenAddress, data: balanceData }, "latest"],
    })) as string;

    console.log("[KwesPay] Raw token balance response:", raw);

    // If eth_call returns "0x" the contract doesn't exist on this chain —
    // this means tokenAddress is wrong for the connected network.
    if (!raw || raw === "0x") {
      throw new KwesPayError(
        `Could not read balance for token ${tokenAddress} on this network. ` +
          `This token may not be deployed on the selected network. Please contact support.`,
        "INSUFFICIENT_BALANCE"
      );
    }

    const tokenBalance = BigInt(raw);
    console.log(
      "[KwesPay] Token balance:",
      tokenBalance.toString(),
      "required:",
      total.toString()
    );

    if (tokenBalance < total) {
      throw new KwesPayError(
        `Insufficient token balance. Required: ${total.toString()} (amount + fee), available: ${tokenBalance.toString()} (base units).`,
        "INSUFFICIENT_BALANCE"
      );
    }
  }

  async pay(params: PayParams): Promise<PaymentResult> {
    const { payload, onStatus } = params;

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

    if (!payload.totalBaseUnits) {
      throw new KwesPayError(
        "Invalid transaction payload — missing totalBaseUnits",
        "TRANSACTION_FAILED"
      );
    }

    if (!payload.deadline) {
      throw new KwesPayError(
        "Invalid transaction payload — missing deadline",
        "TRANSACTION_FAILED"
      );
    }

    if (BigInt(payload.totalBaseUnits) < BigInt(payload.amountBaseUnits)) {
      throw new KwesPayError(
        "Invalid transaction payload — totalBaseUnits cannot be less than amountBaseUnits",
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
      payload.totalBaseUnits,
      onStatus
    );

    const contractAddress = resolveContractAddress(payload.network);

    await this.contractService.ensureApproval(
      payload.tokenAddress,
      payload.totalBaseUnits,
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
        totalBaseUnits: payload.totalBaseUnits,
        backendSignature: payload.backendSignature,
        contractAddress,
        deadline: payload.deadline,
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
