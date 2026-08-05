

import {
  EIP1193Provider,
  PayParams,
  PaymentResult,
  KwesPayError,
  EVMPayParams,
} from "../../types/index.js";
import { ContractService } from "./ContractService.js";
import { resolveContractAddress } from "../../internal/config.js";
import { isZeroAddress } from "../../utils/address.js";
import { extractErrorMessage, isUserRejection } from "../../utils/errors.js";

const GAS_BUFFER = 300_000n * 2_000_000_000n; // ~0.0006 ETH

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
          `Network ${expectedNetwork} (chain ${expectedChainId}) is not added to ` +
            "your wallet. Please add it manually and retry.",
          "WRONG_NETWORK"
        );
      }
      if (isUserRejection(switchErr)) {
        throw new KwesPayError(
          `Network switch to ${expectedNetwork} was rejected. Please switch manually and retry.`,
          "WRONG_NETWORK"
        );
      }
      throw new KwesPayError(
        `Failed to switch to ${expectedNetwork}: ${extractErrorMessage(
          switchErr
        )}`,
        "WRONG_NETWORK"
      );
    }

    const confirmed = parseInt(
      (await this.provider.request({ method: "eth_chainId" })) as string,
      16
    );
    if (confirmed !== expectedChainId) {
      throw new KwesPayError(
        `Wallet is on chain ${confirmed} but payment requires chain ${expectedChainId} ` +
          `(${expectedNetwork}). Please switch your network and retry.`,
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
    const isNative = isZeroAddress(tokenAddress);

    onStatus?.("Checking balance", "Verifying wallet balance…");

    const nativeRaw = (await this.provider.request({
      method: "eth_getBalance",
      params: [walletAddress, "latest"],
    })) as string;
    const nativeBalance =
      nativeRaw && nativeRaw !== "0x" ? BigInt(nativeRaw) : 0n;

    if (isNative) {
      const required = total + GAS_BUFFER;
      if (nativeBalance < required) {
        throw new KwesPayError(
          `Insufficient native balance. Required ~${(
            Number(required) / 1e18
          ).toFixed(8)} ` +
            `(payment + fee + gas), available: ${(
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
        ).toFixed(8)} ` +
          `for gas, available: ${(Number(nativeBalance) / 1e18).toFixed(8)}.`,
        "INSUFFICIENT_BALANCE"
      );
    }

    // ERC-20 balance check
    const balanceData =
      "0x70a08231" + walletAddress.slice(2).toLowerCase().padStart(64, "0");
    const raw = (await this.provider.request({
      method: "eth_call",
      params: [{ to: tokenAddress, data: balanceData }, "latest"],
    })) as string;

    if (!raw || raw === "0x") {
      throw new KwesPayError(
        `Could not read balance for token ${tokenAddress} on this network. ` +
          "This token may not be deployed on the selected network.",
        "INSUFFICIENT_BALANCE"
      );
    }

    const tokenBalance = BigInt(raw);
    if (tokenBalance < total) {
      throw new KwesPayError(
        `Insufficient token balance. Required: ${total.toString()} base units, ` +
          `available: ${tokenBalance.toString()} base units.`,
        "INSUFFICIENT_BALANCE"
      );
    }
  }

  async pay(params: EVMPayParams): Promise<PaymentResult> {
    const { payload, onStatus } = params;

    if (!payload.paymentIdBytes32 || !payload.backendSignature) {
      throw new KwesPayError(
        "Invalid payload — missing paymentIdBytes32 or backendSignature.",
        "TRANSACTION_FAILED"
      );
    }
    if (!payload.vendorIdentifier) {
      throw new KwesPayError(
        "Invalid payload — missing vendorIdentifier.",
        "TRANSACTION_FAILED"
      );
    }
    if (!payload.totalBaseUnits) {
      throw new KwesPayError(
        "Invalid payload — missing totalBaseUnits.",
        "TRANSACTION_FAILED"
      );
    }
    if (!payload.deadline) {
      throw new KwesPayError(
        "Invalid payload — missing deadline.",
        "TRANSACTION_FAILED"
      );
    }
    if (BigInt(payload.totalBaseUnits) < BigInt(payload.amountBaseUnits)) {
      throw new KwesPayError(
        "Invalid payload — totalBaseUnits cannot be less than amountBaseUnits.",
        "TRANSACTION_FAILED"
      );
    }

    await this.ensureCorrectNetwork(
      payload.chainId!,
      payload.network,
      onStatus
    );

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
      payload.chainId!,
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
