import { KwesPayError, PaymentRoute, StellarWalletAdapter } from "../../types/index.js";
import { extractStellarError, isStellarUserRejection, loadStellarSdk } from "./ContractService.js";

const HORIZON_MAINNET = "https://horizon.stellar.org";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export async function stellarWalletAddress(wallet: StellarWalletAdapter): Promise<string> {
  try {
    const res = await wallet.getAddress();
    const address = typeof res === "string" ? res : res?.address;
    if (address) return address;
  } catch (err) {
    throw new KwesPayError("Could not read the connected Stellar wallet's address.", "WALLET_REJECTED", err);
  }
  throw new KwesPayError("Connect a Stellar wallet first.", "WALLET_REJECTED");
}

function horizonCodes(err: unknown): string[] {
  const extras = (err as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } })
    ?.response?.data?.extras?.result_codes;
  return [extras?.transaction, ...(extras?.operations ?? [])].filter(Boolean) as string[];
}

export async function sendStellarDeposit(
  route: PaymentRoute,
  wallet: StellarWalletAdapter,
  onStatus?: (title: string, detail: string) => void,
  horizonUrl: string = HORIZON_MAINNET
): Promise<string> {
  if (route.originChain !== "stellar") {
    throw new KwesPayError(`A ${route.originAsset} deposit can't be sent from a Stellar wallet.`, "CROSS_CHAIN_UNAVAILABLE");
  }
  const { Asset, Horizon, Memo, Operation, TransactionBuilder } = await loadStellarSdk();
  const server = new Horizon.Server(horizonUrl, { allowHttp: horizonUrl.startsWith("http://") });
  const source = await stellarWalletAddress(wallet);

  onStatus?.("Checking balance", `Loading ${source.slice(0, 6)}…`);
  let account;
  try {
    account = await server.loadAccount(source);
  } catch (err) {
    throw new KwesPayError(
      "This Stellar account isn't active yet. Fund it with XLM first.",
      "INSUFFICIENT_BALANCE",
      err
    );
  }
  const native = account.balances.find((b: { asset_type: string }) => b.asset_type === "native") as { balance: string } | undefined;
  if (!native || Number(native.balance) < Number(route.amountInFormatted) + 1.1) {
    throw new KwesPayError(
      `You need about ${route.amountInFormatted} XLM plus the 1 XLM Stellar keeps in every account. Available: ${native?.balance ?? "0"} XLM.`,
      "INSUFFICIENT_BALANCE"
    );
  }

  const fee = String(Math.max(Number(await server.fetchBaseFee().catch(() => 100)), 100) * 2);
  let builder = new TransactionBuilder(account, { fee, networkPassphrase: PUBLIC_PASSPHRASE })
    .addOperation(Operation.payment({ destination: route.depositAddress, asset: Asset.native(), amount: route.amountInFormatted }))
    .setTimeout(300);
  if (route.depositMemo) builder = builder.addMemo(Memo.id(route.depositMemo));
  const tx = builder.build();

  onStatus?.("Confirm payment", `Approve sending ${route.amountInFormatted} XLM in your wallet…`);
  let signedXdr: string;
  try {
    const result = await wallet.signTransaction(tx.toXDR(), { networkPassphrase: PUBLIC_PASSPHRASE });
    signedXdr = typeof result === "string" ? result : result.signedTxXdr;
  } catch (err) {
    if (isStellarUserRejection(err)) throw new KwesPayError("Payment was cancelled in the wallet.", "WALLET_REJECTED", err);
    throw new KwesPayError(`Wallet signing failed: ${extractStellarError(err)}`, "CONTRACT_ERROR", err);
  }

  onStatus?.("Sending payment", "Submitting to the Stellar network…");
  try {
    const res = await server.submitTransaction(TransactionBuilder.fromXDR(signedXdr, PUBLIC_PASSPHRASE));
    return res.hash;
  } catch (err) {
    const codes = horizonCodes(err);
    if (codes.includes("op_underfunded") || codes.includes("tx_insufficient_balance")) {
      throw new KwesPayError("Not enough XLM to send this payment.", "INSUFFICIENT_BALANCE", err);
    }
    throw new KwesPayError(
      `The Stellar network rejected the payment${codes.length ? ` (${codes.join(", ")})` : ""}.`,
      "TRANSACTION_FAILED",
      err
    );
  }
}
