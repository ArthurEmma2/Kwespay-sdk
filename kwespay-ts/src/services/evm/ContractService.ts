

import { encodeFunctionData, type Hex } from "viem";
import { EIP1193Provider, KwesPayError } from "../../types/index.js";
import {
  ensure0x,
  normaliseEvmAddress,
  isZeroAddress,
} from "../../utils/address.js";
import {
  extractErrorMessage,
  decodeRevertReason,
  extractRevertHex,
  isUserRejection,
} from "../../utils/errors.js";



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



export interface CreatePaymentParams {
  paymentIdBytes32: string;
  /** UUID string — passed as vendorId to the EVM contract. */
  vendorIdentifier: string;
  tokenAddress: string;
  amountBaseUnits: string;
  backendSignature: string;
  contractAddress: string;
  totalBaseUnits: string;
  deadline: number;
  chainId?: number;
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


  /**
   * Polygon PoS (mainnet + Amoy) rejects/stalls transactions below a real
   * validator-enforced minimum priority fee (~25-30 gwei) — confirmed by
   * hardhat.config.js hardcoding `gasPrice: 35 gwei` for Amoy deploys.
   * Every other chain here runs sub-gwei priority fees in practice; forcing
   * the same 30 gwei floor on them (as this used to do) overprices a normal
   * approve()/createPayment() by 100-500x on chains like Ethereum mainnet.
   */
  private static readonly PRIORITY_FLOOR_BY_CHAIN: Record<number, bigint> = {
    137: 30_000_000_000n, // polygon
    80002: 30_000_000_000n, // polygonAmoy
  };
  private static readonly DEFAULT_PRIORITY_FLOOR = 10_000_000n; // 0.01 gwei — avoids a literal 0 priority fee, not a "safe default"

  private async getGasParams(chainId?: number): Promise<{
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  }> {
    const priorityFloor =
      (chainId != null &&
        ContractService.PRIORITY_FLOOR_BY_CHAIN[chainId]) ||
      ContractService.DEFAULT_PRIORITY_FLOOR;

    let maxPriorityFeePerGas: bigint;
    try {
      const suggested = (await this.provider.request({
        method: "eth_maxPriorityFeePerGas",
      })) as string;
      const suggestedBig = BigInt(suggested);
      maxPriorityFeePerGas =
        suggestedBig > priorityFloor ? suggestedBig : priorityFloor;
    } catch {
      // Provider doesn't support eth_maxPriorityFeePerGas — use floor.
      maxPriorityFeePerGas = priorityFloor;
    }

    const block = (await this.provider.request({
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    })) as { baseFeePerGas?: string } | null;

    const baseFee =
      block?.baseFeePerGas &&
      block.baseFeePerGas !== "0x0" &&
      block.baseFeePerGas !== "0x"
        ? BigInt(block.baseFeePerGas)
        : 100_000_000n; // 0.1 gwei fallback for chains without EIP-1559

    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

    return {
      maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
      maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
    };
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
      "Transaction receipt timeout — check wallet or block explorer.",
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
    if (isZeroAddress(tokenAddress)) return;

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

    onStatus?.("Approve token", "Please approve in your wallet…");

    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [ensure0x(contractAddress), amount * 2n],
    });

    const gasParams = await this.getGasParams(chainId);

    let txHash: Hex;
    try {
      txHash = (await this.provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: owner,
            to: ensure0x(tokenAddress),
            data: approveData,
            ...gasParams,
          },
        ],
      })) as Hex;
    } catch (err) {
      if (isUserRejection(err)) {
        throw new KwesPayError(
          "Token approval cancelled by user.",
          "APPROVAL_REJECTED",
          err
        );
      }
      throw new KwesPayError(
        `Token approval failed: ${extractErrorMessage(err)}`,
        "CONTRACT_ERROR",
        err
      );
    }

    onStatus?.("Waiting for approval", `Tx: ${txHash.slice(0, 10)}…`);
    const receipt = await this.waitForReceipt(txHash);
    if (receipt.status !== 1) {
      throw new KwesPayError(
        "Approval transaction reverted.",
        "CONTRACT_ERROR"
      );
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
    const isNative = isZeroAddress(params.tokenAddress);
    const nowUnix = Math.floor(Date.now() / 1000);

    if (params.deadline <= nowUnix) {
      throw new KwesPayError(
        `Deadline already expired (deadline=${params.deadline}, now=${nowUnix}).`,
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

    const dryRunParams: Record<string, unknown> = {
      from,
      to: ensure0x(params.contractAddress),
      data,
    };
    if (isNative) dryRunParams["value"] = `0x${total.toString(16)}`;

    try {
      await this.provider.request({
        method: "eth_call",
        params: [dryRunParams, "latest"],
      });
    } catch (callErr) {
      const revertHex = extractRevertHex(callErr);
      const decoded = revertHex ? decodeRevertReason(revertHex) : null;
      const fallback = extractErrorMessage(callErr);
      throw new KwesPayError(
        decoded ?? fallback ?? "Transaction would revert.",
        "CONTRACT_ERROR",
        callErr
      );
    }

    const gasParams = await this.getGasParams(params.chainId);
    const txParams: Record<string, unknown> = {
      from,
      to: ensure0x(params.contractAddress),
      data,
      ...gasParams,
    };
    if (isNative) txParams["value"] = `0x${total.toString(16)}`;

    onStatus?.("Confirm payment", "Please approve in your wallet…");

    let txHash: Hex;
    try {
      txHash = (await this.provider.request({
        method: "eth_sendTransaction",
        params: [txParams],
      })) as Hex;
    } catch (err) {
      if (isUserRejection(err)) {
        throw new KwesPayError(
          "Transaction cancelled by user.",
          "WALLET_REJECTED",
          err
        );
      }
      throw new KwesPayError(
        `Contract call failed: ${extractErrorMessage(err)}`,
        "CONTRACT_ERROR",
        err
      );
    }

    onStatus?.("Waiting for confirmation", `Tx: ${txHash.slice(0, 10)}…`);
    const receipt = await this.waitForReceipt(txHash);

    if (receipt.status !== 1) {
      throw new KwesPayError("Payment transaction reverted.", "CONTRACT_ERROR");
    }

    return { txHash, blockNumber: receipt.blockNumber };
  }
}
