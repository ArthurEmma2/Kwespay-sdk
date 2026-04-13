import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { EIP1193Provider, KwesPayError } from "../types/index.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const PAYMENT_ABI = parseAbi([
  "function createPayment(bytes32 paymentId, string vendorId, address token, uint256 amount, bytes backendSignature) external payable",
]);

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

interface CreatePaymentParams {
  paymentIdBytes32: string;
  vendorIdentifier: string;
  tokenAddress: string;
  amountBaseUnits: string;
  backendSignature: string;
  contractAddress: string;
  chainId: number;
}

function ensure0x(hex: string): Hex {
  return (hex.startsWith("0x") ? hex : `0x${hex}`) as Hex;
}

export class ContractService {
  private readonly provider: EIP1193Provider;

  constructor(provider: EIP1193Provider) {
    this.provider = provider;
  }

  private async getAddress(): Promise<Hex> {
    const accounts = (await this.provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    if (!accounts[0]) {
      throw new KwesPayError("No wallet account available", "WALLET_REJECTED");
    }
    return accounts[0] as Hex;
  }

  private async waitForReceipt(
    txHash: Hex,
    timeoutMs = 120_000
  ): Promise<{ blockNumber: number; status: number }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const receipt = (await this.provider.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      })) as { blockNumber: string; status: string } | null;

      if (receipt) {
        return {
          blockNumber: parseInt(receipt.blockNumber, 16),
          status: parseInt(receipt.status, 16),
        };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new KwesPayError(
      "Transaction receipt timeout — check wallet or block explorer",
      "CONTRACT_ERROR"
    );
  }

  async ensureApproval(
    tokenAddress: string,
    amountBaseUnits: string,
    contractAddress: string,
    chainId: number,
    onStatus?: (title: string, detail: string) => void
  ): Promise<void> {
    if (tokenAddress === ZERO_ADDRESS) return;

    onStatus?.("Checking approval", "Verifying token allowance…");

    const owner = await this.getAddress();
    const amount = BigInt(amountBaseUnits);

    const allowanceData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, ensure0x(contractAddress)],
    });

    const rawAllowance = (await this.provider.request({
      method: "eth_call",
      params: [{ to: ensure0x(tokenAddress), data: allowanceData }, "latest"],
    })) as string;

    const allowance =
      rawAllowance && rawAllowance !== "0x" ? BigInt(rawAllowance) : 0n;

    if (allowance >= amount) return;

    onStatus?.("Approve token", "Please approve in your wallet");

    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [ensure0x(contractAddress), amount * 2n],
    });

    let txHash: Hex;
    try {
      txHash = (await this.provider.request({
        method: "eth_sendTransaction",
        params: [
          { from: owner, to: ensure0x(tokenAddress), data: approveData },
        ],
      })) as Hex;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("rejected") ||
        msg.includes("denied") ||
        msg.includes("ACTION_REJECTED")
      ) {
        throw new KwesPayError(
          "Token approval cancelled by user",
          "APPROVAL_REJECTED",
          err
        );
      }
      throw new KwesPayError(
        `Token approval failed: ${msg}`,
        "CONTRACT_ERROR",
        err
      );
    }

    onStatus?.("Waiting for approval", `Tx: ${txHash.slice(0, 10)}…`);
    const receipt = await this.waitForReceipt(txHash);

    if (receipt.status !== 1) {
      throw new KwesPayError("Approval transaction reverted", "CONTRACT_ERROR");
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  async createPayment(
    params: CreatePaymentParams,
    onStatus?: (title: string, detail: string) => void
  ): Promise<{ txHash: string; blockNumber: number }> {
    const from = await this.getAddress();
    const amount = BigInt(params.amountBaseUnits);
    const isNative = params.tokenAddress === ZERO_ADDRESS;

    const data = encodeFunctionData({
      abi: PAYMENT_ABI,
      functionName: "createPayment",
      args: [
        ensure0x(params.paymentIdBytes32) as `0x${string}`,
        params.vendorIdentifier,
        ensure0x(params.tokenAddress) as `0x${string}`,
        amount,
        ensure0x(params.backendSignature),
      ],
    });

    onStatus?.("Confirm payment", "Please approve in your wallet");

    const txParams: Record<string, unknown> = {
      from,
      to: ensure0x(params.contractAddress),
      data,
    };
    if (isNative) txParams["value"] = `0x${amount.toString(16)}`;

    let txHash: Hex;
    try {
      txHash = (await this.provider.request({
        method: "eth_sendTransaction",
        params: [txParams],
      })) as Hex;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("rejected") ||
        msg.includes("denied") ||
        msg.includes("ACTION_REJECTED") ||
        msg.includes("User denied")
      ) {
        throw new KwesPayError(
          "Transaction cancelled by user",
          "WALLET_REJECTED",
          err
        );
      }
      throw new KwesPayError(
        `Contract call failed: ${msg}`,
        "CONTRACT_ERROR",
        err
      );
    }

    onStatus?.("Waiting for confirmation", `Tx: ${txHash.slice(0, 10)}…`);
    const receipt = await this.waitForReceipt(txHash);

    if (receipt.status !== 1) {
      throw new KwesPayError("Payment transaction reverted", "CONTRACT_ERROR");
    }

    return { txHash, blockNumber: receipt.blockNumber };
  }
}
