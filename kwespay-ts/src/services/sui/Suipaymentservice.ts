import {
  KwesPayError,
  SuiWalletAdapter,
  SuiPayParams,
  PaymentResult,
} from "../../types/index.js";
import { SuiContractService } from "./SuiContractService.js";
import { resolveSuiConfig } from "../../internal/config.js";
import { assertSuiVendorWallet } from "../../utils/address.js";

const SUI_RPC_URLS: Record<string, string> = {
  suiTestnet: "https://fullnode.testnet.sui.io",
  suiMainnet: "https://fullnode.mainnet.sui.io",
};

function resolveRpcUrl(network: string): string {
  const url = SUI_RPC_URLS[network];
  if (!url) {
    throw new KwesPayError(
      `Unknown Sui network "${network}". Expected one of: ${Object.keys(
        SUI_RPC_URLS
      ).join(", ")}.`,
      "CONTRACT_ERROR"
    );
  }
  return url;
}

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

  async pay(params: SuiPayParams): Promise<PaymentResult> {
    const { payload, onStatus } = params;

    this.validatePayload(payload);

    onStatus?.("Connecting wallet", "Getting your Sui wallet address…");
    const payerAddress = await this.getAddress();

    const vendorAddress = payload.vendorSuiWallet!;

    let packageId: string;
    let registryObjectId: string;

    if (params.registryObjectId) {
      registryObjectId = params.registryObjectId;
      try {
        const cfg = resolveSuiConfig(payload.network);
        packageId = cfg.packageId;
      } catch {
        throw new KwesPayError(
          `No package ID configured for network "${payload.network}". ` +
            "Pass suiNetworks in your KwesPayConfig.",
          "CONTRACT_ERROR"
        );
      }
    } else {
      try {
        const cfg = resolveSuiConfig(payload.network);
        packageId = cfg.packageId;
        registryObjectId = cfg.registryObjectId;
      } catch {
        throw new KwesPayError(
          `Sui network "${payload.network}" is not configured. ` +
            "Pass suiNetworks: { suiTestnet: { packageId, registryObjectId } } in your KwesPayConfig.",
          "CONTRACT_ERROR"
        );
      }
    }

    if (!packageId!) {
      throw new KwesPayError(
        `No package ID configured for network "${payload.network}". ` +
          "Set packageId in suiNetworks in your KwesPayConfig.",
        "CONTRACT_ERROR"
      );
    }

    if (!registryObjectId!) {
      throw new KwesPayError(
        `No registry object ID configured for network "${payload.network}". ` +
          "Set registryObjectId in suiNetworks in your KwesPayConfig.",
        "CONTRACT_ERROR"
      );
    }

    const feeBaseUnits = computeFeeBaseUnits(
      payload.totalBaseUnits,
      payload.amountBaseUnits
    );

    // deadline from the backend is Unix seconds; the Move contract expects ms.
    const expiresAtMs = payload.deadline! * 1000;

    // RPC URL is resolved entirely from the network key — no caller input needed.
    const rpcUrl = resolveRpcUrl(payload.network);

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
