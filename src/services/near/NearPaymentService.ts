import {
  KwesPayError,
  NearExecutionStatus,
  NearFunctionCallAction,
  NearPayParams,
  NearTransactionOutcome,
  NearWalletAdapter,
  PaymentResult,
  ResolvedChain,
} from "../../types/index.js";
import { nearAvailableBalance, nearView } from "./rpc.js";

export const NEAR_NATIVE_TOKEN = "NEAR";
const NATIVE_GAS = "100000000000000";
const FT_GAS = "150000000000000";
const GAS_RESERVE_YOCTO = 50_000_000_000_000_000_000_000n;

export interface NearPaymentArgs {
  payment_id: string;
  vendor_id: string;
  vendor_wallet: string;
  amount: string;
  deadline_ms: string;
  signature: string;
}

export interface NearPaymentRequest {
  receiverId: string;
  actions: NearFunctionCallAction[];
}

export async function nearAccountId(wallet: NearWalletAdapter): Promise<string> {
  let accounts: Array<{ accountId: string }>;
  try {
    accounts = await wallet.getAccounts();
  } catch (err) {
    throw new KwesPayError("Could not read the connected NEAR account.", "WALLET_REJECTED", err);
  }
  const accountId = accounts?.[0]?.accountId;
  if (!accountId) {
    throw new KwesPayError("No NEAR account is connected. Sign in to a NEAR wallet first.", "WALLET_REJECTED");
  }
  return accountId;
}

export function buildNearPayment(
  payload: NearPayParams["payload"],
  contractId: string
): NearPaymentRequest {
  const missing = [
    ["paymentIdBytes32", payload.paymentIdBytes32],
    ["backendSignature", payload.backendSignature],
    ["vendorIdentifier", payload.vendorIdentifier],
    ["vendorWallet", payload.vendorWallet],
    ["deadline", payload.deadline],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new KwesPayError(
      `Invalid NEAR payload — missing ${missing.join(", ")}. Update the KwesPay backend.`,
      "TRANSACTION_FAILED"
    );
  }
  if (!contractId) {
    throw new KwesPayError(
      `NEAR network "${payload.network}" is not published by the KwesPay API.`,
      "CONTRACT_ERROR"
    );
  }

  const args: NearPaymentArgs = {
    payment_id: payload.paymentIdBytes32.replace(/^0x/, "").toLowerCase(),
    vendor_id: payload.vendorIdentifier,
    vendor_wallet: payload.vendorWallet!,
    amount: payload.amountBaseUnits,
    deadline_ms: String(BigInt(payload.deadline) * 1000n),
    signature: payload.backendSignature.replace(/^0x/, ""),
  };

  if (payload.tokenAddress === NEAR_NATIVE_TOKEN) {
    return {
      receiverId: contractId,
      actions: [{
        type: "FunctionCall",
        params: { methodName: "pay_near", args: { args }, gas: NATIVE_GAS, deposit: payload.totalBaseUnits },
      }],
    };
  }

  return {
    receiverId: payload.tokenAddress,
    actions: [{
      type: "FunctionCall",
      params: {
        methodName: "ft_transfer_call",
        args: { receiver_id: contractId, amount: payload.totalBaseUnits, msg: JSON.stringify(args) },
        gas: FT_GAS,
        deposit: "1",
      },
    }],
  };
}

function statusOf(status: NearExecutionStatus | string | undefined): NearExecutionStatus {
  return typeof status === "object" && status ? status : {};
}

function describeFailure(failure: unknown): string {
  const text = JSON.stringify(failure);
  const match = /"ExecutionError":"((?:[^"\\]|\\.)*)"/.exec(text);
  return match ? JSON.parse(`"${match[1]}"`) : text;
}

function decodeSuccessValue(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(atob(value));
  } catch {
    return null;
  }
}

export function nearOutcomeFailure(outcome: NearTransactionOutcome | void, native: boolean): string | null {
  if (!outcome) return null;
  const top = statusOf(outcome.status);
  if (top.Failure !== undefined) return describeFailure(top.Failure);
  if (native) return null;

  const receiptFailure = (outcome.receipts_outcome ?? [])
    .map((r) => statusOf(r.outcome?.status).Failure)
    .find((f) => f !== undefined);

  if (top.SuccessValue !== undefined) {
    const used = decodeSuccessValue(top.SuccessValue);
    if (used === "0" || used === 0) {
      return receiptFailure !== undefined
        ? `Payment refunded: ${describeFailure(receiptFailure)}`
        : "Payment refunded: the KwesPay contract did not accept the transfer.";
    }
  }
  return null;
}

export function nearTxHash(outcome: NearTransactionOutcome | void): string {
  return outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id ?? "";
}

export async function checkNearBalance(
  rpcUrl: string,
  accountId: string,
  tokenAddress: string,
  totalBaseUnits: string
): Promise<void> {
  const required = BigInt(totalBaseUnits);
  if (tokenAddress === NEAR_NATIVE_TOKEN) {
    const available = await nearAvailableBalance(rpcUrl, accountId);
    if (available < required + GAS_RESERVE_YOCTO) {
      throw new KwesPayError(
        `Insufficient NEAR balance: ${accountId} needs ${required} yoctoNEAR plus gas, has ${available}.`,
        "INSUFFICIENT_BALANCE"
      );
    }
    return;
  }
  const balance = BigInt((await nearView<string>(rpcUrl, tokenAddress, "ft_balance_of", { account_id: accountId })) ?? "0");
  if (balance < required) {
    throw new KwesPayError(
      `Insufficient ${tokenAddress} balance: ${accountId} needs ${required}, has ${balance}.`,
      "INSUFFICIENT_BALANCE"
    );
  }
}

export class NearPaymentService {
  private readonly wallet: NearWalletAdapter;

  constructor(wallet: NearWalletAdapter) {
    this.wallet = wallet;
  }

  async pay(params: NearPayParams, chain: ResolvedChain): Promise<PaymentResult> {
    const { payload, onStatus } = params;
    const contractId = params.contractId ?? chain.contractAddress;
    const request = buildNearPayment(payload, contractId);
    const customer = await nearAccountId(this.wallet);

    if (payload.payerWalletAddress && payload.payerWalletAddress !== customer) {
      throw new KwesPayError(
        `This payment was authorised for ${payload.payerWalletAddress}, but the connected NEAR account is ${customer}. ` +
          "Create the transaction with the connected account.",
        "WALLET_REJECTED"
      );
    }

    if (chain.rpcUrl) {
      onStatus?.("Checking balance", `Loading ${customer}…`);
      await checkNearBalance(chain.rpcUrl, customer, payload.tokenAddress, payload.totalBaseUnits);
    }

    onStatus?.("Confirm payment", "Please approve in your NEAR wallet…");
    let outcome: NearTransactionOutcome | void;
    try {
      outcome = await this.wallet.signAndSendTransaction({ signerId: customer, ...request });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new KwesPayError(
        /reject|cancel|denied|closed/i.test(message)
          ? "Payment was rejected in the NEAR wallet."
          : `NEAR transaction failed: ${message}`,
        /reject|cancel|denied|closed/i.test(message) ? "WALLET_REJECTED" : "TRANSACTION_FAILED",
        err
      );
    }

    onStatus?.("Waiting for confirmation", "Checking the NEAR transaction…");
    const failure = nearOutcomeFailure(outcome, payload.tokenAddress === NEAR_NATIVE_TOKEN);
    if (failure) {
      throw new KwesPayError(failure, "CONTRACT_ERROR", outcome);
    }

    return {
      txHash: nearTxHash(outcome),
      blockNumber: 0,
      transactionReference: payload.transactionReference,
      paymentIdBytes32: payload.paymentIdBytes32,
    };
  }
}
