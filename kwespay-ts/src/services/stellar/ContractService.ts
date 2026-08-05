

import { KwesPayError, StellarWalletAdapter } from "../../types/index.js";

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 60; // 2 minutes

export interface CreateStellarPaymentParams {
  paymentIdBytes32: string;
  vendorIdentifier: string;
  tokenAddress: string;
  amountBaseUnits: string;
  backendSignature: string;
  contractId: string;
  deadlineLedger: number;
  customerAddress: string;
  rpcUrl: string;
  networkPassphrase: string;
}


async function loadStellarSdk() {
  try {
    return await import("@stellar/stellar-sdk");
  } catch (err) {
    throw new KwesPayError(
      "Could not load '@stellar/stellar-sdk'. It ships as a dependency of " +
        "@kwespay/client — reinstall your dependencies " +
        "(`npm install` / `pnpm install`) and check your bundler externalises " +
        "it correctly if this persists.",
      "CONTRACT_ERROR",
      err
    );
  }
}

export class StellarContractService {
  private readonly wallet: StellarWalletAdapter;
  private readonly rpcUrl: string;

  constructor(wallet: StellarWalletAdapter, rpcUrl: string) {
    this.wallet = wallet;
    this.rpcUrl = rpcUrl;
  }

  private buildPaymentParamsScVal(
    sdk: Awaited<ReturnType<typeof loadStellarSdk>>,
    params: CreateStellarPaymentParams
  ) {
    const { Address, xdr, nativeToScVal } = sdk;

    const paymentIdBytes = hexToBuffer(
      params.paymentIdBytes32,
      32,
      "paymentIdBytes32"
    );
    const signatureBytes = hexToBuffer(
      params.backendSignature,
      64,
      "backendSignature"
    );

    const mapEntry = (key: string, val: InstanceType<typeof xdr.ScVal>) =>
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });

    // Alphabetical by field name — see file header note.
    const entries = [
      mapEntry(
        "amount",
        nativeToScVal(BigInt(params.amountBaseUnits), { type: "i128" })
      ),
      mapEntry("asset", new Address(params.tokenAddress).toScVal()),
      mapEntry(
        "backend_signature",
        nativeToScVal(signatureBytes, { type: "bytes" })
      ),
      mapEntry("customer", new Address(params.customerAddress).toScVal()),
      mapEntry(
        "deadline_ledger",
        nativeToScVal(params.deadlineLedger, { type: "u32" })
      ),
      mapEntry("payment_id", nativeToScVal(paymentIdBytes, { type: "bytes" })),
      mapEntry(
        "vendor_id",
        nativeToScVal(params.vendorIdentifier, { type: "string" })
      ),
    ];

    return xdr.ScVal.scvMap(entries);
  }

  async createPayment(
    params: CreateStellarPaymentParams,
    onStatus?: (title: string, detail: string) => void
  ): Promise<{ txHash: string; ledger: number }> {
    const sdk = await loadStellarSdk();
    const { Contract, TransactionBuilder, BASE_FEE, rpc } = sdk;

    const server = new rpc.Server(this.rpcUrl, {
      allowHttp: this.rpcUrl.startsWith("http://"),
    });

    onStatus?.("Checking balance", "Loading Stellar account…");

    let sourceAccount;
    try {
      sourceAccount = await server.getAccount(params.customerAddress);
    } catch (err) {
      throw new KwesPayError(
        `Could not load Stellar account "${params.customerAddress}". ` +
          "Ensure the wallet is funded and exists on this network.",
        "INSUFFICIENT_BALANCE",
        err
      );
    }

    const contract = new Contract(params.contractId);
    const paramsScVal = this.buildPaymentParamsScVal(sdk, params);

    // Max INCLUSION-fee bid (stroops). BASE_FEE (100) is the network minimum
    // and loses the fee auction whenever Soroban traffic bids higher — on
    // mainnet the going rate is routinely 200+, so 100-stroop transactions
    // were accepted as PENDING, never included, and silently expired
    // (surfacing as confirmation-poll timeouts). Stellar charges the
    // market-clearing price, not the bid, so a generous cap is safe:
    // 100_000 stroops = 0.01 XLM worst case, typically ~200 charged.
    // The Soroban RESOURCE fee is added separately by assembleTransaction().
    const INCLUSION_FEE_STROOPS = "100000";

    const tx = new TransactionBuilder(sourceAccount, {
      fee: INCLUSION_FEE_STROOPS,
      networkPassphrase: params.networkPassphrase,
    })
      .addOperation(contract.call("create_payment", paramsScVal))
      // Validity window for the transaction's time bounds. The clock starts
      // at BUILD time — before the user is asked to approve in their wallet —
      // so it must cover human approval time (mobile wallets like LOBSTR
      // routinely take 1-2 minutes). 60s caused approved transactions to
      // expire before/at submission: never included in a ledger, poll times
      // out. The contract's own deadline_ledger still enforces the real
      // payment deadline.
      .setTimeout(300)
      .build();

    onStatus?.("Confirm payment", "Simulating transaction…");

    let simulated;
    try {
      simulated = await server.simulateTransaction(tx);
    } catch (err) {
      throw new KwesPayError(
        `Stellar simulation failed: ${extractStellarError(err)}`,
        "CONTRACT_ERROR",
        err
      );
    }

    if (rpc.Api.isSimulationError(simulated)) {
      throw new KwesPayError(
        `Transaction would fail: ${simulated.error}`,
        "CONTRACT_ERROR"
      );
    }

    const prepared = rpc.assembleTransaction(tx, simulated).build();

    onStatus?.("Confirm payment", "Please approve in your wallet…");

    let signedXdr: string;
    try {
      const result = await this.wallet.signTransaction(prepared.toXDR(), {
        networkPassphrase: params.networkPassphrase,
      });
      signedXdr = typeof result === "string" ? result : result.signedTxXdr;
    } catch (err) {
      if (isStellarUserRejection(err)) {
        throw new KwesPayError(
          "Transaction cancelled by user.",
          "WALLET_REJECTED",
          err
        );
      }
      throw new KwesPayError(
        `Wallet signing failed: ${extractStellarError(err)}`,
        "CONTRACT_ERROR",
        err
      );
    }

    const signedTx = TransactionBuilder.fromXDR(
      signedXdr,
      params.networkPassphrase
    );

    onStatus?.("Waiting for confirmation", "Submitting to the network…");

    let sendResult;
    try {
      sendResult = await server.sendTransaction(signedTx);
    } catch (err) {
      throw new KwesPayError(
        `Failed to submit Stellar transaction: ${extractStellarError(err)}`,
        "CONTRACT_ERROR",
        err
      );
    }

    if (sendResult.status === "ERROR") {
      throw new KwesPayError(
        `Stellar transaction rejected: ${JSON.stringify(
          sendResult.errorResult ?? ""
        )}`,
        "CONTRACT_ERROR"
      );
    }

    // TRY_AGAIN_LATER means the network did NOT queue the transaction (fee
    // surge, or another tx pending from the same account). Falling through to
    // the confirmation poll would spin for 2 minutes on a hash that can never
    // land — fail fast with an actionable message instead.
    if (sendResult.status === "TRY_AGAIN_LATER") {
      throw new KwesPayError(
        "The Stellar network is busy and did not accept the transaction. " +
          "Please try again in a moment.",
        "CONTRACT_ERROR"
      );
    }

    const txHash = sendResult.hash;
    const finalStatus = await this.pollForConfirmation(server, txHash);

    return { txHash, ledger: finalStatus.ledger };
  }

  private async pollForConfirmation(
    server: Awaited<
      ReturnType<typeof loadStellarSdk>
    >["rpc"]["Server"]["prototype"],
    txHash: string
  ): Promise<{ ledger: number }> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      const res = await server.getTransaction(txHash);

      if (res.status === "SUCCESS") {
        return { ledger: res.ledger };
      }
      if (res.status === "FAILED") {
        throw new KwesPayError(
          `Stellar transaction failed on-chain (hash: ${txHash}).`,
          "CONTRACT_ERROR"
        );
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new KwesPayError(
      `Timed out waiting for Stellar transaction confirmation (hash: ${txHash}). ` +
        "Check the transaction status manually via a block explorer.",
      "CONTRACT_ERROR"
    );
  }
}



/**
 * Uses Uint8Array rather than Node's Buffer — this file runs in the browser,
 * and Buffer has no polyfill wired into the build. @stellar/stellar-sdk's
 * nativeToScVal(..., { type: "bytes" }) documents Uint8Array as a valid
 * input, so this needs no Node-specific APIs.
 */
function hexToBuffer(
  hex: string,
  expectedBytes: number,
  field: string
): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new KwesPayError(
      `${field} must be a valid hex string. Value: "${hex}"`,
      "TRANSACTION_FAILED"
    );
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  if (bytes.length !== expectedBytes) {
    throw new KwesPayError(
      `${field} must be exactly ${expectedBytes} bytes (got ${bytes.length}). Value: "${hex}"`,
      "TRANSACTION_FAILED"
    );
  }
  return bytes;
}

function extractStellarError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown Stellar error";
  }
}

function isStellarUserRejection(err: unknown): boolean {
  const msg = extractStellarError(err).toLowerCase();
  return (
    msg.includes("rejected") ||
    msg.includes("declined") ||
    msg.includes("user declined") ||
    msg.includes("cancelled")
  );
}
