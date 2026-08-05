export type EVMNetworkKey =
  | "ethereum"
  | "sepolia"
  | "base"
  | "baseSepolia"
  | "polygon"
  | "polygonAmoy"
  | "lisk"
  | "liskTestnet"
  | "mezo"
  | "mezoTestnet"
  | "arbitrum"
  | "arbitrumSepolia";

export type SuiNetworkKey = "suiTestnet" | "suiMainnet";

export type StellarNetworkKey = "stellarTestnet" | "stellarMainnet";

export type NetworkKey = EVMNetworkKey | SuiNetworkKey | StellarNetworkKey;

export type TokenSymbol =
  | "ETH"
  | "BTC"
  | "MATIC"
  | "POL"
  | "USDT"
  | "USDC"
  | "USDC.E"
  | "USDBC"
  | "DAI"
  | "LSK"
  | "MUSD"
  | "ARB"
  | "SUI"
  | "MEZO"
  | "XLM"
  | (string & {});

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface SuiWalletAdapter {
  connect(): Promise<{ accounts: Array<{ address: string }> }>;
  accounts?: Array<{ address: string }>;
  signAndExecuteTransactionBlock(params: {
    transactionBlock: unknown;
    options?: { showEffects?: boolean; showEvents?: boolean };
  }): Promise<SuiTransactionResult>;
}

export interface SuiTransactionResult {
  digest: string;
  effects?: {
    status?: { status: "success" | "failure"; error?: string };
  };
}

export interface SuiNetworkConfig {
  packageId: string;
  registryObjectId: string;
}

/**
 * Minimal wallet adapter shape, compatible with @stellar/freighter-api
 * (getAddress / signTransaction) and similar Stellar wallet extensions.
 */
export interface StellarWalletAdapter {
  getAddress(): Promise<{ address: string } | string>;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; network?: string }
  ): Promise<{ signedTxXdr: string } | string>;
}

export interface StellarNetworkConfig {
  contractId: string;
  /** Defaults to the public Soroban RPC endpoint for the network if omitted. */
  rpcUrl?: string;
}

export interface KwesPayConfig {
  apiKey: string;
  suiNetworks?: Partial<Record<SuiNetworkKey, SuiNetworkConfig>>;
  stellarNetworks?: Partial<Record<StellarNetworkKey, StellarNetworkConfig>>;
  graphqlEndpoint?: string;
}

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
  quoteReference: string;
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
  amountBaseUnits: string;
  totalBaseUnits: string;
  chainId?: number;
  expiresAt: string;
  /**
   * For EVM: Unix timestamp (seconds).
   * For Sui: Unix timestamp (seconds).
   * For Stellar: a ledger sequence number, NOT a Unix timestamp.
   */
  deadline: number;
  transactionReference: string;
  transactionStatus: TransactionStatus;
  network: NetworkKey;
  vendorIdentifier: string;
  vendorSuiWallet: string | null;
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

export interface EVMPayParams {
  provider: EIP1193Provider;
  payload: TransactionPayload;
  onStatus?: (title: string, detail: string) => void;
}

export interface SuiPayParams {
  wallet: SuiWalletAdapter;
  payload: TransactionPayload;
  registryObjectId?: string;
  onStatus?: (title: string, detail: string) => void;
}

export interface StellarPayParams {
  wallet: StellarWalletAdapter;
  payload: TransactionPayload;
  /** Override the contract ID resolved from configureStellar()/config. */
  contractId?: string;
  onStatus?: (title: string, detail: string) => void;
}

export type PayParams = EVMPayParams | SuiPayParams | StellarPayParams;

export interface PaymentResult {
  txHash: string;
  transactionReference: string;
  paymentIdBytes32: string;
  /** Block number (EVM), checkpoint (Sui), or ledger sequence (Stellar). */
  blockNumber: number;
}

/**
 * Per-network token availability for a merchant.
 * tokens: list of token symbols the merchant accepts on this network.
 * family: "evm" | "sui" | "stellar" — the wallet family required.
 */
export interface NetworkTokenConfig {
  network: NetworkKey;
  tokens: TokenSymbol[];
  family: "evm" | "sui" | "stellar";
}

/**
 * Merchant configuration returned by getMerchantConfig().
 *
 * enabledNetworks: every network the merchant has explicitly enabled.
 * networkTokenMap: network → accepted token symbols on that network.
 *   This is the intersection of the merchant's acceptedCurrencies and
 *   the tokens the KwesPay backend supports on each network.
 * hasEvmWallet: whether the merchant has an EVM wallet configured.
 * hasSuiWallet: whether the merchant has a Sui wallet configured.
 * hasStellarWallet: whether the merchant has a Stellar wallet configured.
 * vendorIdentifier: the merchant's UUID.
 * businessName: display name.
 */
export interface MerchantConfig {
  vendorIdentifier: string;
  businessName: string;
  enabledNetworks: NetworkKey[];
  networkTokenMap: NetworkTokenConfig[];
  hasEvmWallet: boolean;
  hasSuiWallet: boolean;
  hasStellarWallet: boolean;
}

export interface VendorInfo {
  vendorPk: number;
  vendorIdentifier: string;
  businessName: string;
}

/**
 * Scope of a validated API key.
 *
 * allowedVendors: every vendor PK this key currently has access to — the
 *   current, complete list (kept up to date as vendors are added/removed).
 * isAuthorizedForVendor: set only when a vendorIdentifier was passed to
 *   validateKey(). `null` means "couldn't be confirmed from this call,"
 *   not "not authorized" — the real check always happens server-side in
 *   quote()/getQuote().
 */
export interface AccessKeyScope {
  allowedVendors: number[] | null;
  allowedNetworks: string[] | null;
  allowedTokens: string[] | null;
  isAuthorizedForVendor: boolean | null;
}

export interface ValidateKeyResult {
  isValid: true;
  keyId: number | null;
  keyLabel: string | null;
  activeFlag: boolean | null;
  expirationDate: string | null;
  /**
   * Reflects only the vendor that existed when this key was created — not
   * the full set of vendors the key can access. Use `scope.allowedVendors`
   * for the current, complete list.
   */
  vendorInfo: VendorInfo | null;
  scope: AccessKeyScope;
}

export interface InvalidKeyResult {
  isValid: false;
  error: string;
}

export type ValidateKeyResponse = ValidateKeyResult | InvalidKeyResult;

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
  | "MERCHANT_NOT_FOUND"
  | "NETWORK_NOT_ENABLED"
  | "TOKEN_NOT_SUPPORTED"
  | "UNKNOWN";

export class KwesPayError extends Error {
  readonly code: KwesPayErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: KwesPayErrorCode, cause?: unknown) {
    super(message);
    this.name = "KwesPayError";
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
