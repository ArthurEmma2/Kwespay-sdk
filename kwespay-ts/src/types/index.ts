export interface KwesPayConfig {
  apiKey: string;
}

export type NetworkKey =
  | "ethereum"
  | "sepolia"
  | "base"
  | "baseSepolia"
  | "polygon"
  | "polygonAmoy"
  | "lisk"
  | "liskTestnet";

export type TokenSymbol =
  | "ETH"
  | "MATIC"
  | "USDT"
  | "USDC"
  | "USDC.E"
  | "USDBC"
  | "DAI"
  | "LSK"
  | string;

export interface QuoteParams {
  vendorIdentifier: string;
  fiatAmount: number;
  fiatCurrency?: string;
  cryptoCurrency: TokenSymbol;
  network: NetworkKey;
  payerWalletAddress?: string;
}

export interface QuoteResult {
  quoteId: number;
  cryptoCurrency: string;
  tokenAddress: string;
  amountBaseUnits: string;
  displayAmount: number;
  network: string;
  chainId: number;
  expiresAt: string;
}

export interface TransactionPayload {
  paymentIdBytes32: string;
  backendSignature: string;
  tokenAddress: string;
  amountBaseUnits: string;
  chainId: number;
  expiresAt: string;
  transactionReference: string;
  transactionStatus: TransactionStatus;
  network: NetworkKey;
  vendorIdentifier: string;
}

export type TransactionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "expired"
  | "underpaid"
  | "overpaid"
  | "refunded";

export interface TransactionStatusResult {
  transactionReference: string;
  transactionStatus: TransactionStatus;
  blockchainHash: string | null;
  blockchainNetwork: string | null;
  displayAmount: number;
  cryptoCurrency: string;
  payerWalletAddress: string;
  initiatedAt: string;
}

export interface PayParams {
  provider: EIP1193Provider;
  payload: TransactionPayload;
  onStatus?: (title: string, detail: string) => void;
}

export interface PaymentResult {
  txHash: string;
  transactionReference: string;
  paymentIdBytes32: string;
  blockNumber: number;
}

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export type KwesPayErrorCode =
  | "INVALID_KEY"
  | "QUOTE_EXPIRED"
  | "QUOTE_USED"
  | "QUOTE_NOT_FOUND"
  | "TRANSACTION_FAILED"
  | "WALLET_REJECTED"
  | "INSUFFICIENT_BALANCE"
  | "APPROVAL_REJECTED"
  | "CONTRACT_ERROR"
  | "NETWORK_ERROR"
  | "WRONG_NETWORK"
  | "UNKNOWN";

export class KwesPayError extends Error {
  readonly code: KwesPayErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: KwesPayErrorCode, cause?: unknown) {
    super(message);
    this.name = "KwesPayError";
    this.code = code;
    this.cause = cause;
  }
}
