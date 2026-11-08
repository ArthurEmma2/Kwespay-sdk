import {
  KwesPayError,
  SuiWalletAdapter,
  SuiPayParams,
  ResolvedChain,
  PaymentResult,
} from "../../types/index.js";
import { SuiContractService } from "./SuiContractService.js";
import { assertSuiVendorWallet } from "../../utils/address.js";

function computeFeeBaseUnits(
  totalBaseUnits: string,
  amountBaseUnits: string
): string {
  const fee = BigInt(totalBaseUnits) - BigInt(amountBaseUnits);
  if (fee < 0n) {
    throw new KwesPayError(
      "totalBaseUnits must be >= amountBaseUnits",
      "TRANSACTION_FAILED"
    );
  }
  return fee.toString();
}

export class SuiPaymentService {
  private readonly wallet: SuiWalletAdapter;
  private readonly contractService: SuiContractService;

  constructor(wallet: SuiWalletAdapter) {
    this.wallet = wallet;
    this.contractService = new SuiContractService(wallet);
  }

  private async getAddress(): Promise<string> {
    const accounts = this.wallet.accounts;
    if (accounts && accounts.length > 0 && accounts[0].address) {
      return accounts[0].address;
    }
    const result = await this.wallet.connect();
    const addr = result.accounts?.[0]?.address;
    if (!addr) {
      throw new KwesPayError(
        "No Sui wallet account available — please connect your wallet",
        "WALLET_REJECTED"
      );
    }
    return addr;
  }

  private validatePayload(payload: SuiPayParams["payload"]): void {
    if (!payload.paymentIdBytes32 || !payload.backendSignature) {
      throw new KwesPayError(
        "Invalid payload — missing paymentIdBytes32 or backendSignature",
        "TRANSACTION_FAILED"
      );
    }
    if (!payload.vendorIdentifier) {
      throw new KwesPayError(
        "Invalid payload — missing vendorIdentifier",
        "TRANSACTION_FAILED"
      );
    }
    if (!payload.totalBaseUnits || !payload.amountBaseUnits) {
      throw new KwesPayError(
        "Invalid payload — missing totalBaseUnits or amountBaseUnits",
        "TRANSACTION_FAILED"
      );
    }
    if (!payload.deadline) {
      throw new KwesPayError(
        "Invalid payload — missing deadline",
        "TRANSACTION_FAILED"
      );
    }
    if (BigInt(payload.totalBaseUnits) < BigInt(payload.amountBaseUnits)) {
      throw new KwesPayError(
        "Invalid payload — totalBaseUnits cannot be less than amountBaseUnits",
        "TRANSACTION_FAILED"
      );
    }
    const nowUnix = Math.floor(Date.now() / 1000);
    if (payload.deadline <= nowUnix) {
      throw new KwesPayError(
        `Payment deadline already expired (deadline=${payload.deadline}, now=${nowUnix})`,
        "CONTRACT_ERROR"
      );
    }

    assertSuiVendorWallet(
      payload.vendorSuiWallet,
      "SuiPaymentService.validatePayload"
    );
  }

  async pay(params: SuiPayParams, chain: ResolvedChain): Promise<PaymentResult> {
    const { payload, onStatus } = params;

    this.validatePayload(payload);

    onStatus?.("Connecting wallet", "Getting your Sui wallet address…");
    const payerAddress = await this.getAddress();

    const vendorAddress = payload.vendorSuiWallet!;

    const packageId = chain.contractAddress;
    const registryObjectId = chain.registryObjectId;
    const rpcUrl = chain.rpcUrl;

    if (!packageId || !registryObjectId || !rpcUrl) {
      throw new KwesPayError(
        `Sui network "${payload.network}" is not published by the KwesPay API.`,
        "CONTRACT_ERROR"
      );
    }

    const feeBaseUnits = computeFeeBaseUnits(
      payload.totalBaseUnits,
      payload.amountBaseUnits
    );

    // deadline from the backend is Unix seconds; the Move contract expects ms.
    const expiresAtMs = payload.deadline! * 1000;

    const { txHash, blockNumber } = await this.contractService.createPayment(
      {
        payerAddress,
        paymentIdHex: payload.paymentIdBytes32,
        vendorAddress,
        coinType: payload.tokenAddress,
        amountBaseUnits: payload.amountBaseUnits,
        feeBaseUnits,
        totalBaseUnits: payload.totalBaseUnits,
        backendSignature: payload.backendSignature,
        expiresAtMs,
        packageId,
        registryObjectId,
        rpcUrl,
      },
      onStatus
    );

    return {
      txHash,
      blockNumber,
      transactionReference: payload.transactionReference,
      paymentIdBytes32: payload.paymentIdBytes32,
    };
  }
}
