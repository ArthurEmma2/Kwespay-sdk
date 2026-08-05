import {
  KwesPayConfig,
  QuoteParams,
  QuoteResult,
  TransactionPayload,
  TransactionStatus,
  TransactionStatusResult,
  PayParams,
  EVMPayParams,
  SuiPayParams,
  StellarPayParams,
  PaymentResult,
  MerchantConfig,
  NetworkKey,
  TokenSymbol,
  KwesPayError,
  ValidateKeyResponse,
} from "../types/index.js";
import { gqlRequest } from "../utils/gqlClient.js";
import {
  GQL_VALIDATE_KEY,
  GQL_GET_VENDOR,
  GQL_CREATE_QUOTE,
  GQL_CREATE_TRANSACTION,
  GQL_TRANSACTION_STATUS,
  GQL_SUBMIT_TRANSACTION_HASH,
} from "../gql/queries.js";
import {
  isSuiNetwork,
  isStellarNetwork,
  resolveSuiConfig,
  configureSui,
  configureStellar,
  configureEndpoint,
} from "../internal/config.js";
import { PaymentService } from "../services/evm/PaymentService.js";
import { buildMerchantConfig } from "../utils/merchantConfig.js";
import { SuiPaymentService } from "../services/sui/Suipaymentservice.js";
import { StellarPaymentService } from "../services/stellar/StellarPaymentService.js";


interface RawValidateKey {
  validateAccessKey: {
    isValid: boolean;
    keyId: number | null;
    keyLabel: string | null;
    activeFlag: boolean | null;
    expirationDate: string | null;
    vendorInfo: {
      vendorPk: number;
      vendorIdentifier: string;
      businessName: string;
    } | null;
    allowedVendors: number[] | null;
    allowedNetworks: string[] | null;
    allowedTokens: string[] | null;
    error: string | null;
  };
}

interface RawGetVendor {
  getVendor: {
    vendorPk: number;
    vendorIdentifier: string;
    businessName: string;
    acceptedCurrencies: string[];
    enabledNetworks: string[];
    hasEvmWallet: boolean;
    hasSuiWallet: boolean;
    hasStellarWallet: boolean;
    activeStatus: boolean;
  } | null;
}

interface RawQuoteResponse {
  success: boolean;
  message: string;
  quoteId: number | null;
  quoteReference: string | null;
  cryptoCurrency: string | null;
  tokenAddress: string | null;
  amountBaseUnits: string | null;
  totalBaseUnits: string | null;
  displayAmount: number | null;
  network: string | null;
  chainId: number | null;
  expiresAt: string | null;
}

interface RawCreateQuote {
  createQuote: RawQuoteResponse;
}

interface RawTransactionVendorInfo {
  vendorIdentifier: string;
  suiWalletAddress: string | null;
}

interface RawTransactionResponse {
  success: boolean;
  message: string;
  paymentIdBytes32: string | null;
  backendSignature: string | null;
  tokenAddress: string | null;
  amountBaseUnits: string | null;
  totalBaseUnits: string | null;
  chainId: number | null;
  deadline: number | null;
  expiresAt: string | null;
  transaction: {
    transactionReference: string;
    transactionStatus: string;
    vendorInfo: RawTransactionVendorInfo;
  } | null;
}

interface RawCreateTransaction {
  createTransaction: RawTransactionResponse;
}

interface RawTransactionStatus {
  getTransactionStatus: {
    transactionReference: string;
    transactionStatus: string;
    blockchainHash: string | null;
    blockchainNetwork: string | null;
    displayAmount: number;
    cryptoCurrency: string;
    payerWalletAddress: string;
    initiatedAt: string;
  };
}



export class KwesPayClient {
  private readonly apiKey: string;

  constructor(config: KwesPayConfig) {
    if (!config.apiKey) {
      throw new KwesPayError(
        "KwesPayClient requires an apiKey. " +
          "Generate one from your KwesPay dashboard under API Keys.",
        "INVALID_KEY"
      );
    }
    this.apiKey = config.apiKey;

    if (config.suiNetworks) {
      configureSui(config.suiNetworks);
    }
    if (config.stellarNetworks) {
      configureStellar(config.stellarNetworks);
    }
    if (config.graphqlEndpoint) {
      configureEndpoint(config.graphqlEndpoint);
    }
  }



  /**
   * Validates this client's API key and reports what it currently has access to.
   *
   * KwesPay keys belong to the merchant account, not to a single vendor — a
   * key keeps working for every vendor on the account, including ones added
   * after the key was created. `vendorInfo` only ever reflects the vendor
   * that existed at the moment the key was generated, so don't use it to
   * decide whether a *different* vendor is currently covered. Use
   * `scope.allowedVendors` for that, or pass `vendorIdentifier` to get
   * `scope.isAuthorizedForVendor` for one specific vendor.
   *
   * @param vendorIdentifier optional — when provided, resolves
   *   `scope.isAuthorizedForVendor` for that vendor specifically.
   */
  async validateKey(vendorIdentifier?: string): Promise<ValidateKeyResponse> {
    const data = await gqlRequest<RawValidateKey>(GQL_VALIDATE_KEY, {
      accessKey: this.apiKey,
    });
    const r = data.validateAccessKey;
    if (!r.isValid) {
      return {
        isValid: false as const,
        error: r.error ?? "Invalid access key",
      };
    }

    const allowedVendors = r.allowedVendors ?? null;
    const isAuthorizedForVendor =
      vendorIdentifier == null
        ? null
        : allowedVendors != null &&
          r.vendorInfo != null &&
          r.vendorInfo.vendorIdentifier === vendorIdentifier;

    return {
      isValid: true as const,
      keyId: r.keyId,
      keyLabel: r.keyLabel,
      activeFlag: r.activeFlag,
      expirationDate: r.expirationDate,
      vendorInfo: r.vendorInfo,
      scope: {
        allowedVendors,
        allowedNetworks: r.allowedNetworks ?? null,
        allowedTokens: r.allowedTokens ?? null,
        // Best-effort: null means "unknown from this call," not "no." The
        // real check happens server-side in quote()/getQuote() regardless.
        isAuthorizedForVendor,
      },
    };
  }

  // ── Merchant configuration ──────────────────────────────────────────────────

  /**
   * Returns the merchant's enabled networks and accepted tokens per network.
   *
   * Use this before rendering the payment widget to populate the network
   * and token selectors with only the options this merchant supports.
   *
   * The result is the intersection of:
   *   - networks the vendor has enabled in their dashboard
   *   - tokens the vendor declared in acceptedCurrencies
   *   - tokens the KwesPay backend supports on each of those networks
   *   - wallet families the vendor has configured (EVM / Sui / Stellar)
   *
   * @throws KwesPayError with code MERCHANT_NOT_FOUND if the vendorIdentifier
   *   does not exist or the vendor account is inactive.
   */
  async getMerchantConfig(vendorIdentifier: string): Promise<MerchantConfig> {
    if (!vendorIdentifier || !vendorIdentifier.trim()) {
      throw new KwesPayError(
        "getMerchantConfig requires a non-empty vendorIdentifier. " +
          "Pass the vendor id from your KwesPay dashboard.",
        "MERCHANT_NOT_FOUND"
      );
    }

    const data = await gqlRequest<RawGetVendor>(GQL_GET_VENDOR, {
      vendorIdentifier,
    });

    const vendor = data.getVendor;

    if (!vendor) {
      throw new KwesPayError(
        `Vendor "${vendorIdentifier}" not found. ` +
          "Verify the vendorIdentifier is correct and the account exists.",
        "MERCHANT_NOT_FOUND"
      );
    }

    if (!vendor.activeStatus) {
      throw new KwesPayError(
        `Vendor "${vendorIdentifier}" (${vendor.businessName}) is inactive. ` +
          "The vendor must activate their account in the KwesPay dashboard.",
        "MERCHANT_NOT_FOUND"
      );
    }

    return buildMerchantConfig({
      vendorIdentifier: vendor.vendorIdentifier,
      businessName: vendor.businessName,
      enabledNetworks: vendor.enabledNetworks,
      acceptedCurrencies: vendor.acceptedCurrencies,
      hasEvmWallet: vendor.hasEvmWallet,
      hasSuiWallet: vendor.hasSuiWallet,
      hasStellarWallet: vendor.hasStellarWallet,
    });
  }

  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    const data = await gqlRequest<RawCreateQuote>(
      GQL_CREATE_QUOTE,
      {
        input: {
          vendorIdentifier: params.vendorIdentifier,
          fiatAmount: params.fiatAmount,
          fiatCurrency: params.fiatCurrency ?? "USD",
          cryptoCurrency: params.cryptoCurrency,
          network: params.network,
        },
      },
      this.apiKey
    );
    const q = data.createQuote;
    if (!q.success) {
      throw new KwesPayError(
        _enrichQuoteError(
          q.message ?? "Quote creation failed",
          params.vendorIdentifier,
          params.network,
          params.cryptoCurrency
        ),
        _quoteErrCode(q.message ?? "")
      );
    }
    return normaliseQuote(q);
  }

  // ── Quote + signed transaction payload (wallet-ready) ──────────────────────

  async quote(params: QuoteParams): Promise<TransactionPayload> {
    const sui = isSuiNetwork(params.network);
    const stellar = isStellarNetwork(params.network);

    const quoteData = await gqlRequest<RawCreateQuote>(
      GQL_CREATE_QUOTE,
      {
        input: {
          vendorIdentifier: params.vendorIdentifier,
          fiatAmount: params.fiatAmount,
          fiatCurrency: params.fiatCurrency ?? "USD",
          cryptoCurrency: params.cryptoCurrency,
          network: params.network,
        },
      },
      this.apiKey
    );
    const q = quoteData.createQuote;
    if (!q.success) {
      throw new KwesPayError(
        _enrichQuoteError(
          q.message ?? "Quote creation failed",
          params.vendorIdentifier,
          params.network,
          params.cryptoCurrency
        ),
        _quoteErrCode(q.message ?? "")
      );
    }
    assertQuoteFields(q, sui, stellar, params.vendorIdentifier, params.network);

    const txData = await gqlRequest<RawCreateTransaction>(
      GQL_CREATE_TRANSACTION,
      {
        input: {
          quoteId: q.quoteId,
          payerWalletAddress: params.payerWalletAddress ?? "",
        },
      },
      this.apiKey
    );
    const t = txData.createTransaction;
    if (!t.success) {
      throw new KwesPayError(
        _enrichTxError(
          t.message ?? "Transaction creation failed",
          params.vendorIdentifier,
          params.network
        ),
        _txErrCode(t.message ?? "")
      );
    }
    assertTransactionFields(
      t,
      sui,
      stellar,
      params.vendorIdentifier,
      params.network
    );

    return {
      paymentIdBytes32: t.paymentIdBytes32!,
      backendSignature: t.backendSignature!,
      tokenAddress: t.tokenAddress!,
      amountBaseUnits: t.amountBaseUnits!,
      totalBaseUnits: t.totalBaseUnits!,
      chainId: t.chainId ?? undefined,
      deadline: t.deadline!,
      expiresAt: t.expiresAt!,
      transactionReference: t.transaction!.transactionReference,
      transactionStatus: t.transaction!.transactionStatus as TransactionStatus,
      network: params.network,
      vendorIdentifier: params.vendorIdentifier,
      vendorSuiWallet: t.transaction!.vendorInfo?.suiWalletAddress ?? null,
    };
  }


  async pay(params: PayParams): Promise<PaymentResult> {
    const result = await this._dispatchPay(params);

    // Report the broadcast tx hash to the backend immediately. This is the
    // single most important step for confirmation speed: it hands the
    // backend the exact hash so it can confirm via a direct receipt check
    // within seconds, rather than waiting for its block listener to discover
    // the payment by scanning up to REQUIRED_CONFIRMATIONS blocks behind the
    // chain tip (the source of the multi-minute "pending" delay). Best-effort
    // and non-fatal: if it fails, the listener still settles the payment — we
    // just lose the speedup, so it must never break a successful payment.
    if (result?.txHash && result?.transactionReference) {
      await this.submitTransactionHash(
        result.transactionReference,
        result.txHash
      ).catch(() => {});
    }

    return result;
  }

  private async _dispatchPay(params: PayParams): Promise<PaymentResult> {
    const { payload } = params;

    if (isStellarNetwork(payload.network)) {
      const stellarParams = params as StellarPayParams;
      if (!stellarParams.wallet) {
        throw new KwesPayError(
          "Stellar payment requires a `wallet` (StellarWalletAdapter). " +
            `Network "${payload.network}" is a Stellar network — pass \`wallet\` instead of \`provider\`.`,
          "WALLET_REJECTED"
        );
      }
      return new StellarPaymentService(stellarParams.wallet).pay(stellarParams);
    }

    if (isSuiNetwork(payload.network)) {
      const suiParams = params as SuiPayParams;
      if (!suiParams.wallet) {
        throw new KwesPayError(
          "Sui payment requires a `wallet` (SuiWalletAdapter). " +
            `Network "${payload.network}" is a Sui network — pass \`wallet\` instead of \`provider\`.`,
          "WALLET_REJECTED"
        );
      }

      let registryObjectId = suiParams.registryObjectId ?? "";
      if (!registryObjectId) {
        const cfg = resolveSuiConfig(payload.network);
        registryObjectId = cfg.registryObjectId;
      }

      return new SuiPaymentService(suiParams.wallet).pay({
        ...suiParams,
        registryObjectId,
      });
    }

    const evmParams = params as EVMPayParams;
    if (!evmParams.provider) {
      throw new KwesPayError(
        "EVM payment requires a `provider` (EIP1193Provider). " +
          `Network "${payload.network}" is an EVM network — pass \`provider\` instead of \`wallet\`.`,
        "WALLET_REJECTED"
      );
    }

    return new PaymentService(evmParams.provider).pay(evmParams);
  }



  async getTransactionStatus(
    transactionReference: string
  ): Promise<TransactionStatusResult> {
    const data = await gqlRequest<RawTransactionStatus>(
      GQL_TRANSACTION_STATUS,
      { transactionReference }
    );
    const r = data.getTransactionStatus;
    return {
      transactionReference: r.transactionReference,
      transactionStatus: r.transactionStatus as TransactionStatus,
      blockchainHash: r.blockchainHash,
      blockchainNetwork: r.blockchainNetwork,
      displayAmount: r.displayAmount,
      cryptoCurrency: r.cryptoCurrency,
      payerWalletAddress: r.payerWalletAddress,
      initiatedAt: r.initiatedAt,
    };
  }

  /**
   * Report an on-chain transaction hash to the backend so it can confirm the
   * payment directly (fast path) instead of waiting for its block listener.
   * Called automatically by `pay()`; also exposed for manual/recovery use.
   */
  async submitTransactionHash(
    transactionReference: string,
    txHash: string
  ): Promise<void> {
    await gqlRequest(
      GQL_SUBMIT_TRANSACTION_HASH,
      { input: { transactionReference, txHash } },
      this.apiKey
    );
  }

  async pollTransactionStatus(
    transactionReference: string,
    options: {
      onStatus?: (status: TransactionStatus) => void;
      intervalMs?: number;
      maxAttempts?: number;
    } = {}
  ): Promise<TransactionStatusResult> {
    const { onStatus, intervalMs = 2000, maxAttempts = 150 } = options;
    const TERMINAL: TransactionStatus[] = [
      "completed",
      "failed",
      "expired",
      "underpaid",
      "overpaid",
      "refunded",
    ];

    return new Promise((resolve, reject) => {
      let attempts = 0;
      const id = setInterval(async () => {
        attempts++;
        try {
          const status = await this.getTransactionStatus(transactionReference);
          onStatus?.(status.transactionStatus);
          if (TERMINAL.includes(status.transactionStatus)) {
            clearInterval(id);
            resolve(status);
          } else if (attempts >= maxAttempts) {
            clearInterval(id);
            reject(
              new KwesPayError(
                `Status polling timed out after ${maxAttempts} attempts ` +
                  `for transaction "${transactionReference}". ` +
                  "Check the transaction status manually via getTransactionStatus().",
                "UNKNOWN"
              )
            );
          }
        } catch (err) {
          if (attempts >= maxAttempts) {
            clearInterval(id);
            reject(err);
          }
        }
      }, intervalMs);
    });
  }
}



function normaliseQuote(q: RawQuoteResponse): QuoteResult {
  return {
    quoteId: q.quoteId!,
    quoteReference: q.quoteReference!,
    cryptoCurrency: q.cryptoCurrency!,
    tokenAddress: q.tokenAddress!,
    amountBaseUnits: q.amountBaseUnits!,
    totalBaseUnits: q.totalBaseUnits!,
    displayAmount: q.displayAmount!,
    network: q.network!,
    chainId: q.chainId ?? 0,
    expiresAt: q.expiresAt!,
  };
}

function assertQuoteFields(
  q: RawQuoteResponse,
  isSui: boolean,
  isStellar: boolean,
  vendorIdentifier: string,
  network: string
): void {
  const missing: string[] = [];
  if (q.quoteId == null) missing.push("quoteId");
  if (!q.quoteReference) missing.push("quoteReference");
  if (!q.cryptoCurrency) missing.push("cryptoCurrency");
  if (!q.tokenAddress) missing.push("tokenAddress");
  if (!q.amountBaseUnits) missing.push("amountBaseUnits");
  if (!q.totalBaseUnits) missing.push("totalBaseUnits");
  if (!q.network) missing.push("network");
  if (!isSui && !isStellar && q.chainId == null) missing.push("chainId");
  if (!q.expiresAt) missing.push("expiresAt");
  if (missing.length) {
    throw new KwesPayError(
      `Incomplete quote response for vendor="${vendorIdentifier}" network="${network}" — ` +
        `missing fields: [${missing.join(", ")}]. ` +
        "This indicates a backend version mismatch. " +
        "Ensure your backend is up to date and exposes all QuoteResponse fields.",
      "UNKNOWN"
    );
  }
}

function assertTransactionFields(
  t: RawTransactionResponse,
  isSui: boolean,
  isStellar: boolean,
  vendorIdentifier: string,
  network: string
): void {
  const missing: string[] = [];
  if (!t.paymentIdBytes32) missing.push("paymentIdBytes32");
  if (!t.backendSignature) missing.push("backendSignature");
  if (!t.tokenAddress) missing.push("tokenAddress");
  if (!t.amountBaseUnits) missing.push("amountBaseUnits");
  if (!t.totalBaseUnits) missing.push("totalBaseUnits");
  if (!isSui && !isStellar && t.chainId == null) missing.push("chainId");
  if (!t.deadline) missing.push("deadline");
  if (!t.expiresAt) missing.push("expiresAt");
  if (!t.transaction) missing.push("transaction");
  if (missing.length) {
    throw new KwesPayError(
      `Incomplete transaction response for vendor="${vendorIdentifier}" network="${network}" — ` +
        `missing fields: [${missing.join(", ")}]. ` +
        "This indicates a backend version mismatch. " +
        "Ensure your backend is up to date and exposes all PaymentTransactionResponse fields.",
      "UNKNOWN"
    );
  }
}

function _enrichQuoteError(
  msg: string,
  vendorIdentifier: string,
  network: string,
  token: string
): string {
  const base = msg.trim();

  if (base.toLowerCase().includes("not enabled")) {
    return (
      `[vendor="${vendorIdentifier}" network="${network}" token="${token}"] ` +
      `${base} ` +
      "Call getMerchantConfig() first and only call quote() with networks and tokens " +
      "present in the returned networkTokenMap."
    );
  }

  if (
    base.toLowerCase().includes("not supported") ||
    base.toLowerCase().includes("not configured")
  ) {
    return (
      `[vendor="${vendorIdentifier}" network="${network}" token="${token}"] ` +
      `${base} ` +
      "Verify the token is in the vendor's acceptedCurrencies and is supported " +
      "by KwesPay on this network."
    );
  }

  if (base.toLowerCase().includes("wallet")) {
    return (
      `[vendor="${vendorIdentifier}" network="${network}"] ` +
      `${base} ` +
      "The vendor must configure a wallet for this network family in their dashboard."
    );
  }

  return `[vendor="${vendorIdentifier}" network="${network}" token="${token}"] ${base}`;
}

function _enrichTxError(
  msg: string,
  vendorIdentifier: string,
  network: string
): string {
  const base = msg.trim();

  if (base.toLowerCase().includes("expired")) {
    return (
      `[vendor="${vendorIdentifier}" network="${network}"] ` +
      `${base} ` +
      "Quotes expire after 10 minutes. Call quote() again to get a fresh quote."
    );
  }

  if (base.toLowerCase().includes("already been used")) {
    return (
      `[vendor="${vendorIdentifier}" network="${network}"] ` +
      `${base} ` +
      "A quote can only be used once. Call quote() to obtain a new quote."
    );
  }

  if (base.toLowerCase().includes("not found")) {
    return (
      `[vendor="${vendorIdentifier}" network="${network}"] ` +
      `${base} ` +
      "The quoteId returned by createQuote does not exist on the backend. " +
      "Do not cache or reuse quoteId values across sessions."
    );
  }

  return `[vendor="${vendorIdentifier}" network="${network}"] ${base}`;
}

function _quoteErrCode(msg: string): KwesPayError["code"] {
  const m = msg.toLowerCase();
  if (m.includes("expired")) return "QUOTE_EXPIRED";
  if (m.includes("key")) return "INVALID_KEY";
  if (m.includes("not enabled") || m.includes("not enabled"))
    return "NETWORK_NOT_ENABLED";
  if (m.includes("not supported") || m.includes("not configured"))
    return "TOKEN_NOT_SUPPORTED";
  if (m.includes("vendor not found")) return "MERCHANT_NOT_FOUND";
  if (m.includes("wallet")) return "TRANSACTION_FAILED";
  return "UNKNOWN";
}

function _txErrCode(msg: string): KwesPayError["code"] {
  const m = msg.toLowerCase();
  if (m.includes("expired")) return "QUOTE_EXPIRED";
  if (m.includes("already been used")) return "QUOTE_USED";
  if (m.includes("not found")) return "QUOTE_NOT_FOUND";
  if (m.includes("key")) return "INVALID_KEY";
  return "UNKNOWN";
}
