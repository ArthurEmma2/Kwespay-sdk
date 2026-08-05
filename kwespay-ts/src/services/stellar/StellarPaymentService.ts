
import {
  PaymentResult,
  StellarPayParams,
  KwesPayError,
} from "../../types/index.js";
import { StellarContractService } from "./ContractService.js";
import { resolveStellarNetworkConfig } from "../../internal/config.js";

export class StellarPaymentService {
  private readonly wallet: StellarPayParams["wallet"];

  constructor(wallet: StellarPayParams["wallet"]) {
    this.wallet = wallet;
  }

  async pay(params: StellarPayParams): Promise<PaymentResult> {
    const { payload, onStatus } = params;

    if (!payload.paymentIdBytes32 || !payload.backendSignature) {
      throw new KwesPayError(
        "Invalid payload — missing paymentIdBytes32 or backendSignature.",
        "TRANSACTION_FAILED"
      );
    }
    if (!payload.vendorIdentifier) {
      throw new KwesPayError(
        "Invalid payload — missing vendorIdentifier.",
        "TRANSACTION_FAILED"
      );
    }
    if (!payload.deadline) {
      throw new KwesPayError(
        "Invalid payload — missing deadline (expected a Stellar ledger sequence number).",
        "TRANSACTION_FAILED"
      );
    }

    const { rpcUrl, networkPassphrase, contractId } =
      resolveStellarNetworkConfig(payload.network);

    let customerAddress: string;
    try {
      const addr = await this.wallet.getAddress();
      customerAddress = typeof addr === "string" ? addr : addr.address;
    } catch (err) {
      throw new KwesPayError(
        "Could not read the connected Stellar wallet's address.",
        "WALLET_REJECTED",
        err
      );
    }

    const contractService = new StellarContractService(this.wallet, rpcUrl);

    const { txHash, ledger } = await contractService.createPayment(
      {
        paymentIdBytes32: payload.paymentIdBytes32,
        vendorIdentifier: payload.vendorIdentifier,
        tokenAddress: payload.tokenAddress,
        amountBaseUnits: payload.amountBaseUnits,
        backendSignature: payload.backendSignature,
        contractId: params.contractId ?? contractId,
        deadlineLedger: payload.deadline,
        customerAddress,
        rpcUrl,
        networkPassphrase,
      },
      onStatus
    );

    return {
      txHash,
      blockNumber: ledger,
      transactionReference: payload.transactionReference,
      paymentIdBytes32: payload.paymentIdBytes32,
    };
  }
}
