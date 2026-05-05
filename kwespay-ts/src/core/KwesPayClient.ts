
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

const PLATFORM_FEE_BPS = 50n; // 0.5%
const BASIS_POINTS = 10_000n;

function computeFee(amountBaseUnits: string): bigint {
  return (BigInt(amountBaseUnits) * PLATFORM_FEE_BPS) / BASIS_POINTS;
}

function computeTotal(amountBaseUnits: string): string {
  return (BigInt(amountBaseUnits) + computeFee(amountBaseUnits)).toString();
}



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
    deadline: number | null;
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

  // getQuote (price preview only — no transaction created)

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
      throw new KwesPayError(msg, _quoteErrCode(msg));
    }
    return {
      quoteId: q.quoteId!,
      cryptoCurrency: q.cryptoCurrency!,
      tokenAddress: q.tokenAddress!,
      amountBaseUnits: q.amountBaseUnits!,
      // totalBaseUnits = amountBaseUnits + fee — safe to compute here for UI
      totalBaseUnits: computeTotal(q.amountBaseUnits!),
      displayAmount: q.displayAmount!,
      network: q.network!,
      chainId: q.chainId!,
      expiresAt: q.expiresAt!,
    };
  }

  //  quote() — full flow: price + transaction, returns wallet-ready payload 

  async quote(params: QuoteParams): Promise<TransactionPayload> {
    // Step 1 — get price & lock quote
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
      throw new KwesPayError(msg, _quoteErrCode(msg));
    }

    // Step 2 — create transaction (backend signs payment params incl. deadline)
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
      throw new KwesPayError(msg, _txErrCode(msg));
    }

    // deadline must be present — it's part of the on-chain signature
    if (!t.deadline) {
      throw new KwesPayError(
        "Backend did not return a deadline. Cannot construct a valid payment.",
        "TRANSACTION_FAILED"
      );
    }

    // totalBaseUnits: what the customer must actually send (amount + fee).
    // We compute this from the signed amountBaseUnits using the same formula
    // the contract uses: (amount * 50) / 10000.  We do NOT trust a
    // client-side totalBaseUnits for security — but computing it here is safe
    // because amountBaseUnits came from the backend-signed response.
    const amountBaseUnits = t.amountBaseUnits!;
    const totalBaseUnits = computeTotal(amountBaseUnits);

    return {
      paymentIdBytes32: t.paymentIdBytes32!,
      backendSignature: t.backendSignature!,
      tokenAddress: t.tokenAddress!,
      amountBaseUnits,
      totalBaseUnits,
      chainId: t.chainId!,
      deadline: t.deadline, // ← from backend, part of signed hash
      expiresAt: t.expiresAt!,
      transactionReference: t.transaction!.transactionReference,
      transactionStatus: t.transaction!.transactionStatus as TransactionStatus,
      network: params.network,
      vendorIdentifier: params.vendorIdentifier,
    };
  }

  // pay()

  async pay(params: PayParams): Promise<PaymentResult> {
    return new PaymentService(params.provider).pay(params);
  }

  //  status polling

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

//  Error code helpers 

function _quoteErrCode(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes("expired")) return "QUOTE_EXPIRED" as const;
  if (m.includes("key")) return "INVALID_KEY" as const;
  return "UNKNOWN" as const;
}

function _txErrCode(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes("expired")) return "QUOTE_EXPIRED" as const;
  if (m.includes("already been used")) return "QUOTE_USED" as const;
  if (m.includes("not found")) return "QUOTE_NOT_FOUND" as const;
  if (m.includes("key")) return "INVALID_KEY" as const;
  return "UNKNOWN" as const;
}
