import {
  KwesPayConfig,
  QuoteParams,
  QuoteResult,
  TransactionPayload,
  TransactionStatus,
  TransactionStatusResult,
  PayParams,
  PaymentResult,
  KwesPayError,
} from "../types/index.js";
import { gqlRequest } from "../utils/gqlClient.js";
import {
  GQL_VALIDATE_KEY,
  GQL_CREATE_QUOTE,
  GQL_CREATE_TRANSACTION,
  GQL_TRANSACTION_STATUS,
} from "../gql/queries.js";
import { PaymentService } from "../services/PaymentService.js";

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

interface RawCreateQuote {
  createQuote: {
    success: boolean;
    message: string;
    quoteId: number | null;
    cryptoCurrency: string | null;
    tokenAddress: string | null;
    amountBaseUnits: string | null;
    displayAmount: number | null;
    network: string | null;
    chainId: number | null;
    expiresAt: string | null;
  };
}

interface RawCreateTransaction {
  createTransaction: {
    success: boolean;
    message: string;
    paymentIdBytes32: string | null;
    backendSignature: string | null;
    tokenAddress: string | null;
    amountBaseUnits: string | null;
    chainId: number | null;
    expiresAt: string | null;
    transaction: {
      transactionReference: string;
      transactionStatus: string;
    } | null;
  };
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
    if (!config.apiKey)
      throw new KwesPayError("apiKey is required", "INVALID_KEY");
    this.apiKey = config.apiKey;
  }

  async validateKey() {
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
    return {
      isValid: true as const,
      keyId: r.keyId,
      keyLabel: r.keyLabel,
      activeFlag: r.activeFlag,
      expirationDate: r.expirationDate,
      vendorInfo: r.vendorInfo,
      scope: {
        allowedVendors: r.allowedVendors ?? null,
        allowedNetworks: r.allowedNetworks ?? null,
        allowedTokens: r.allowedTokens ?? null,
      },
    };
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
      const msg = q.message ?? "Quote creation failed";
      const code = msg.toLowerCase().includes("expired")
        ? "QUOTE_EXPIRED"
        : msg.toLowerCase().includes("key")
        ? "INVALID_KEY"
        : "UNKNOWN";
      throw new KwesPayError(msg, code);
    }
    return {
      quoteId: q.quoteId!,
      cryptoCurrency: q.cryptoCurrency!,
      tokenAddress: q.tokenAddress!,
      amountBaseUnits: q.amountBaseUnits!,
      displayAmount: q.displayAmount!,
      network: q.network!,
      chainId: q.chainId!,
      expiresAt: q.expiresAt!,
    };
  }

  async quote(params: QuoteParams): Promise<TransactionPayload> {
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
      const msg = q.message ?? "Quote creation failed";
      const code = msg.toLowerCase().includes("expired")
        ? "QUOTE_EXPIRED"
        : msg.toLowerCase().includes("key")
        ? "INVALID_KEY"
        : "UNKNOWN";
      throw new KwesPayError(msg, code);
    }

    const txData = await gqlRequest<RawCreateTransaction>(
      GQL_CREATE_TRANSACTION,
      {
        input: {
          quoteId: q.quoteId,
          payerWalletAddress: params.payerWalletAddress,
        },
      },
      this.apiKey
    );
    const t = txData.createTransaction;
    if (!t.success) {
      const msg = t.message ?? "Transaction creation failed";
      const code = msg.toLowerCase().includes("expired")
        ? "QUOTE_EXPIRED"
        : msg.toLowerCase().includes("already been used")
        ? "QUOTE_USED"
        : msg.toLowerCase().includes("not found")
        ? "QUOTE_NOT_FOUND"
        : msg.toLowerCase().includes("key")
        ? "INVALID_KEY"
        : "UNKNOWN";
      throw new KwesPayError(msg, code);
    }
    return {
      paymentIdBytes32: t.paymentIdBytes32!,
      backendSignature: t.backendSignature!,
      tokenAddress: t.tokenAddress!,
      amountBaseUnits: t.amountBaseUnits!,
      chainId: t.chainId!,
      expiresAt: t.expiresAt!,
      transactionReference: t.transaction!.transactionReference,
      transactionStatus: t.transaction!.transactionStatus as TransactionStatus,
      network: params.network,
      vendorIdentifier: params.vendorIdentifier,
    };
  }

  async pay(params: PayParams): Promise<PaymentResult> {
    return new PaymentService(params.provider).pay(params);
  }

  async getTransactionStatus(
    transactionReference: string
  ): Promise<TransactionStatusResult> {
    const data = await gqlRequest<RawTransactionStatus>(
      GQL_TRANSACTION_STATUS,
      {
        transactionReference,
      }
    );
    const r = data.getTransactionStatus;
    return {
      transactionReference: r.transactionReference,
      transactionStatus:
        r.transactionStatus as TransactionStatusResult["transactionStatus"],
      blockchainHash: r.blockchainHash,
      blockchainNetwork: r.blockchainNetwork,
      displayAmount: r.displayAmount,
      cryptoCurrency: r.cryptoCurrency,
      payerWalletAddress: r.payerWalletAddress,
      initiatedAt: r.initiatedAt,
    };
  }

  async pollTransactionStatus(
    transactionReference: string,
    options: {
      onStatus?: (status: TransactionStatus) => void;
      intervalMs?: number;
      maxAttempts?: number;
    } = {}
  ): Promise<TransactionStatusResult> {
    const { onStatus, intervalMs = 4000, maxAttempts = 60 } = options;
    let attempts = 0;
    const terminal: TransactionStatus[] = [
      "completed",
      "failed",
      "expired",
      "underpaid",
      "overpaid",
      "refunded",
    ];
    return new Promise((resolve, reject) => {
      const id = setInterval(async () => {
        attempts++;
        try {
          const status = await this.getTransactionStatus(transactionReference);
          onStatus?.(status.transactionStatus);
          if (terminal.includes(status.transactionStatus)) {
            clearInterval(id);
            resolve(status);
          } else if (attempts >= maxAttempts) {
            clearInterval(id);
            reject(new KwesPayError("Status polling timed out", "UNKNOWN"));
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
