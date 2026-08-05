import {
  SuiWalletAdapter,
  KwesPayError,
  SuiTransactionResult,
} from "../../types";

const SUI_CLOCK_ID = "0x6";

interface SuiPaymentParams {
  payerAddress: string;
  paymentIdHex: string;
  vendorAddress: string;
  coinType: string;
  amountBaseUnits: string;
  feeBaseUnits: string;
  totalBaseUnits: string;
  backendSignature: string;
  expiresAtMs: number;
  packageId: string;
  registryObjectId: string;
  rpcUrl: string;
}

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function hexToBytes(hex: string): number[] {
  const clean = strip0x(hex);
  const result: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    result.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return result;
}

/** Pads a Sui object ID to the canonical 0x + 64 hex chars form. */
function padSuiObjectId(id: string): string {
  const hex = strip0x(id);
  const padded = "0x" + hex.padStart(64, "0");
  if (hex.length !== 64) {
    console.warn(
      `[SuiContractService] padSuiObjectId: "${id}" was ${hex.length} hex chars — padded to "${padded}"`
    );
  }
  return padded;
}

function extractErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e["message"] === "string") return e["message"];
    try {
      return JSON.stringify(err);
    } catch {
      return "Sui wallet error";
    }
  }
  return String(err);
}

function isFailedEffects(effects: unknown): boolean {
  if (!effects) return false;
  if (typeof effects === "string") {
    return (
      effects.toLowerCase().includes("failure") ||
      effects.toLowerCase().includes("execfailure")
    );
  }
  if (typeof effects === "object") {
    const e = effects as Record<string, unknown>;
    const status = e["status"] as Record<string, unknown> | undefined;
    if (status?.["status"] === "failure") return true;
    if (typeof e["rawEffects"] === "string") {
      return (e["rawEffects"] as string).toLowerCase().includes("failure");
    }
  }
  return false;
}

function isSuiNativeCoin(coinType: string): boolean {
  return coinType.toLowerCase().endsWith("::sui::sui");
}

async function fetchCoinObjectId(
  rpcUrl: string,
  owner: string,
  coinType: string
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "suix_getCoins",
        params: [owner, coinType, null, 1],
      }),
    });
  } catch (err) {
    throw new KwesPayError(
      `Network error fetching ${coinType} coins from ${rpcUrl}: ${extractErrorMessage(
        err
      )}`,
      "CONTRACT_ERROR"
    );
  }

  if (!response.ok) {
    throw new KwesPayError(
      `Sui RPC returned HTTP ${response.status} while fetching coins.`,
      "CONTRACT_ERROR"
    );
  }

  const json = await response.json();

  if (json.error) {
    throw new KwesPayError(
      `Sui RPC error fetching coins: ${
        json.error.message ?? JSON.stringify(json.error)
      }`,
      "CONTRACT_ERROR"
    );
  }

  const coins: Array<{ coinObjectId: string }> = json.result?.data ?? [];
  if (!coins.length) {
    throw new KwesPayError(
      `No ${coinType} coins found in payer wallet (${owner}). ` +
        "Please ensure your wallet holds this token.",
      "INSUFFICIENT_BALANCE"
    );
  }

  return coins[0].coinObjectId;
}

export class SuiContractService {
  private readonly wallet: SuiWalletAdapter;

  constructor(wallet: SuiWalletAdapter) {
    this.wallet = wallet;
  }

  private async getAddress(): Promise<string> {
    const accounts = this.wallet.accounts;
    if (accounts && accounts.length > 0 && accounts[0]?.address) {
      return accounts[0].address;
    }

    console.warn(
      "[SuiContractService] accounts not pre-populated — calling connect()"
    );
    const result = await this.wallet.connect();
    const resolvedAccounts: Array<{ address: string }> = Array.isArray(result)
      ? result
      : (result as { accounts?: Array<{ address: string }> })?.accounts ?? [];

    const addr = resolvedAccounts[0]?.address;
    if (!addr) {
      throw new KwesPayError(
        "No Sui wallet account available after connect().",
        "WALLET_REJECTED"
      );
    }
    return addr;
  }

  async createPayment(
    params: SuiPaymentParams,
    onStatus?: (title: string, detail: string) => void
  ): Promise<{ txHash: string; blockNumber: number }> {
    let TxClass: new () => SuiTransactionLike;
    try {
      const mod = await import("@mysten/sui/transactions");
      const Tx = (mod as any).Transaction ?? (mod as any).TransactionBlock;
      if (!Tx)
        throw new Error("Neither Transaction nor TransactionBlock found");
      TxClass = Tx;
    } catch (err) {
      throw new KwesPayError(
        "Could not load '@mysten/sui/transactions'. It ships as a dependency " +
          "of @kwespay/client — reinstall your dependencies " +
          "(`npm install` / `pnpm install`) and check your bundler externalises " +
          "it correctly if this persists.",
        "CONTRACT_ERROR",
        err
      );
    }

    const address = await this.getAddress();

    const nowMs = Date.now();
    if (params.expiresAtMs <= nowMs) {
      throw new KwesPayError(
        `Payment deadline already expired (expires=${params.expiresAtMs}, now=${nowMs})`,
        "CONTRACT_ERROR"
      );
    }

    const registryObjectId = padSuiObjectId(params.registryObjectId);

    const total = BigInt(params.totalBaseUnits);
    const paymentIdBytes = hexToBytes(params.paymentIdHex);
    const signatureBytes = hexToBytes(params.backendSignature);

    const tx = new TxClass() as SuiTransactionLike;

    if (typeof (tx as any).setSender === "function") {
      (tx as any).setSender(address);
    }

    let totalCoin: unknown;
    if (isSuiNativeCoin(params.coinType)) {
      [totalCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(total)]);
    } else {
      const coinObjectId = await fetchCoinObjectId(
        params.rpcUrl,
        address,
        params.coinType
      );
      [totalCoin] = tx.splitCoins(tx.object(coinObjectId), [
        tx.pure.u64(total),
      ]);
    }

    tx.moveCall({
      target: `${params.packageId}::payment::pay`,
      typeArguments: [params.coinType],
      arguments: [
        tx.object(registryObjectId),
        tx.pure.vector("u8", paymentIdBytes),
        tx.pure.address(params.vendorAddress),
        tx.pure.u64(BigInt(params.amountBaseUnits)),
        tx.pure.u64(BigInt(params.expiresAtMs)),
        totalCoin as any,
        tx.pure.vector("u8", signatureBytes),
        tx.object(SUI_CLOCK_ID),
      ],
    });

    onStatus?.("Confirm payment", "Please approve in your Sui wallet");

    let result: SuiTransactionResult;
    try {
      result = await this.wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        options: { showEffects: true, showEvents: true },
      });
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      if (
        msg.toLowerCase().includes("rejected") ||
        msg.toLowerCase().includes("denied") ||
        msg.toLowerCase().includes("cancelled") ||
        msg.toLowerCase().includes("cancel")
      ) {
        throw new KwesPayError(
          "Transaction cancelled by user",
          "WALLET_REJECTED",
          err
        );
      }
      throw new KwesPayError(
        `Sui transaction failed: ${msg}`,
        "CONTRACT_ERROR",
        err
      );
    }

    if (isFailedEffects(result.effects)) {
      const reason =
        typeof result.effects === "object" && result.effects !== null
          ? (result.effects as any)?.status?.error ?? "Move call reverted"
          : "Move call reverted";
      throw new KwesPayError(
        `Sui payment reverted: ${reason}`,
        "CONTRACT_ERROR"
      );
    }

    if (!result.digest) {
      throw new KwesPayError(
        "Wallet returned no transaction digest — payment status unknown.",
        "CONTRACT_ERROR"
      );
    }

    return { txHash: result.digest, blockNumber: 0 };
  }
}

interface SuiTransactionLike {
  gas: unknown;
  setSender(address: string): void;
  splitCoins(coin: unknown, amounts: unknown[]): unknown[];
  object(id: string): unknown;
  pure: {
    u64(value: bigint | number): unknown;
    address(value: string): unknown;
    vector(type: string, value: number[]): unknown;
  };
  moveCall(params: {
    target: string;
    typeArguments?: string[];
    arguments?: unknown[];
  }): unknown;
}
