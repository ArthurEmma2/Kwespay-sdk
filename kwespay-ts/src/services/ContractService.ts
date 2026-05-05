import { encodeFunctionData, type Hex } from "viem";
import { EIP1193Provider, KwesPayError } from "../types/index.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const PAYMENT_ABI = [
  {
    name: "createPayment",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "paymentId", type: "bytes32" },
          { name: "vendorId", type: "string" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "backendSignature", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

interface CreatePaymentParams {
  paymentIdBytes32: string;
  vendorIdentifier: string;
  tokenAddress: string;
  amountBaseUnits: string;
  backendSignature: string;
  contractAddress: string;
  totalBaseUnits: string;
  deadline: number;
  chainId: number;
}

function ensure0x(hex: string): Hex {
  return (hex.startsWith("0x") ? hex : `0x${hex}`) as Hex;
}

function extractErrorMessage(err: unknown): string {
  if (err === null || err === undefined) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e["message"] === "string") return e["message"];
    if (typeof e["shortMessage"] === "string") return e["shortMessage"];
    if (e["data"] && typeof e["data"] === "object") {
      const d = e["data"] as Record<string, unknown>;
      if (typeof d["message"] === "string") return d["message"];
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "Contract error";
    }
  }
  return String(err);
}

// Decode a revert reason from an eth_call response hex string.
// Handles the standard Error(string) ABI encoding: 0x08c379a0 + abi-encoded string.
function decodeRevertReason(hex: string): string | null {
  try {
    if (!hex || hex === "0x") return null;
    const ERROR_SELECTOR = "08c379a0";
    if (hex.startsWith("0x" + ERROR_SELECTOR)) {
      const data = hex.slice(10); // strip 0x + 4-byte selector
      const offset = parseInt(data.slice(0, 64), 16) * 2;
      const length = parseInt(data.slice(offset, offset + 64), 16) * 2;
      const msgHex = data.slice(offset + 64, offset + 64 + length);
      const bytes = new Uint8Array(
        msgHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
      );
      return new TextDecoder().decode(bytes);
    }
    // Custom error or panic — return raw
    return `raw revert: ${hex.slice(0, 66)}`;
  } catch {
    return null;
  }
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

    onStatus?.("Checking approval", "Verifying token allowance...");

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
      const msg = extractErrorMessage(err);
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

    onStatus?.("Waiting for approval", `Tx: ${txHash.slice(0, 10)}...`);
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
    const total = BigInt(params.totalBaseUnits);
    const isNative = params.tokenAddress === ZERO_ADDRESS;
    const nowUnix = Math.floor(Date.now() / 1000);

    // Log everything going into the contract call so mismatches are visible.
    console.log("[ContractService] createPayment params:", {
      from,
      contractAddress: params.contractAddress,
      paymentIdBytes32: params.paymentIdBytes32,
      vendorIdentifier: params.vendorIdentifier,
      tokenAddress: params.tokenAddress,
      amountBaseUnits: params.amountBaseUnits,
      totalBaseUnits: params.totalBaseUnits,
      deadline: params.deadline,
      deadlineReadable: new Date(params.deadline * 1000).toISOString(),
      nowUnix,
      deadlineValid: params.deadline > nowUnix,
      chainId: params.chainId,
      isNative,
      backendSignature: params.backendSignature,
    });

    if (params.deadline <= nowUnix) {
      throw new KwesPayError(
        `Deadline already expired (deadline=${params.deadline}, now=${nowUnix})`,
        "CONTRACT_ERROR"
      );
    }

    const data = encodeFunctionData({
      abi: PAYMENT_ABI,
      functionName: "createPayment",
      args: [
        {
          paymentId: ensure0x(params.paymentIdBytes32) as `0x${string}`,
          vendorId: params.vendorIdentifier,
          token: ensure0x(params.tokenAddress) as `0x${string}`,
          amount,
          deadline: BigInt(params.deadline),
          backendSignature: ensure0x(params.backendSignature),
        },
      ],
    });

    const txParams: Record<string, unknown> = {
      from,
      to: ensure0x(params.contractAddress),
      data,
    };
    if (isNative) {
      txParams["value"] = `0x${total.toString(16)}`;
    }

    console.log(
      "[ContractService] eth_call dry-run — checking for revert before sending..."
    );

    // Dry-run via eth_call to surface the revert reason without spending gas.
    try {
      await this.provider.request({
        method: "eth_call",
        params: [txParams, "latest"],
      });
      console.log("[ContractService] eth_call passed — no revert detected");
    } catch (callErr: unknown) {
      // Log full raw error — MetaMask wraps revert data several levels deep
      console.error(
        "[ContractService] eth_call raw error dump:",
        JSON.stringify(callErr, null, 2)
      );

      const e = callErr as Record<string, unknown> | null;
      const inner = e?.["error"] as Record<string, unknown> | undefined;
      const innerData = inner?.["data"];

      const revertHex: string | undefined =
        // ethers-style: err.data
        (typeof e?.["data"] === "string" ? (e["data"] as string) : undefined) ||
        // MetaMask EIP-1193: err.error.data (string)
        (typeof inner?.["data"] === "string"
          ? (inner["data"] as string)
          : undefined) ||
        // MetaMask nested: err.error.data.data
        (typeof innerData === "object" && innerData !== null
          ? ((innerData as Record<string, unknown>)["data"] as string | undefined)
          : undefined) ||
        // viem-style: err.cause.data
        (typeof (e?.["cause"] as Record<string, unknown>)?.["data"] === "string"
          ? ((e?.["cause"] as Record<string, unknown>)["data"] as string)
          : undefined);

      const decoded = revertHex ? decodeRevertReason(revertHex) : null;
      const fallback = extractErrorMessage(callErr);

      console.error("[ContractService] eth_call revert parsed:", {
        revertHex,
        decoded,
        fallback,
      });

      throw new KwesPayError(
        decoded ?? fallback ?? "Transaction would revert",
        "CONTRACT_ERROR",
        callErr
      );
    }

    onStatus?.("Confirm payment", "Please approve in your wallet");

    let txHash: Hex;
    try {
      txHash = (await this.provider.request({
        method: "eth_sendTransaction",
        params: [txParams],
      })) as Hex;
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
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

    console.log("[ContractService] tx submitted:", txHash);
    onStatus?.("Waiting for confirmation", `Tx: ${txHash.slice(0, 10)}...`);
    const receipt = await this.waitForReceipt(txHash);

    console.log("[ContractService] receipt:", {
      txHash,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
    });

    if (receipt.status !== 1) {
      throw new KwesPayError("Payment transaction reverted", "CONTRACT_ERROR");
    }

    return { txHash, blockNumber: receipt.blockNumber };
  }
}
