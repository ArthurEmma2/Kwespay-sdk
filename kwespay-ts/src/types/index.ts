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
  | "liskTestnet"
  | "mezoTestnet";

export type TokenSymbol =
  | "ETH"
  | "BTC"
  | "MATIC"
  | "USDT"
  | "USDC"
  | "USDC.E"
  | "USDBC"
  | "DAI"
  | "LSK"
  | "MUSD"
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
  totalBaseUnits: string;
  displayAmount: number;
  network: string;
  chainId: number;
  expiresAt: string;
}

export interface TransactionPayload {
  paymentIdBytes32: string;
  backendSignature: string;
  tokenAddress: string;
  /**
   * The exact amount the merchant must receive, in token smallest units.
   * This is what the backend signed — passed directly to the contract.
   */
  amountBaseUnits: string;
  /**
   * amountBaseUnits + platform fee, in token smallest units.
   * This is what the customer must send — used for balance checks and ERC-20 approvals.
   * Computed and provided by the backend. Never derived on the client.
   */
  totalBaseUnits: string;
  chainId: number;
  expiresAt: string;
  transactionReference: string;
  transactionStatus: TransactionStatus;
  network: NetworkKey;
  deadline: number | null;
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
