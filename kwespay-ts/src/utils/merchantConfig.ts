import {
  NetworkKey,
  TokenSymbol,
  NetworkTokenConfig,
  MerchantConfig,
  PaymentNetwork,
} from "../types/index.js";

const CANONICAL_EQUIVALENTS: Record<string, string> = {
  "USDC.E": "USDC",
  USDBC: "USDC",
};

export function buildMerchantConfig(
  networks: PaymentNetwork[],
  raw: {
    vendorIdentifier: string;
    businessName: string;
    enabledNetworks: string[];
    acceptedCurrencies: string[];
    hasEvmWallet: boolean;
    hasSuiWallet: boolean;
    hasStellarWallet: boolean;
    hasNearWallet: boolean;
  }
): MerchantConfig {
  const accepted = new Set(raw.acceptedCurrencies.map((t) => t.toUpperCase()));
  const enabled = new Set(raw.enabledNetworks);
  const hasWallet = {
    evm: raw.hasEvmWallet,
    sui: raw.hasSuiWallet,
    stellar: raw.hasStellarWallet,
    near: raw.hasNearWallet,
  };

  const networkTokenMap: NetworkTokenConfig[] = [];

  for (const network of networks) {
    if (!enabled.has(network.key) || !hasWallet[network.ecosystem]) continue;

    const tokens = network.tokens
      .map((t) => t.symbol.toUpperCase())
      .filter((t) => accepted.has(t) || accepted.has(CANONICAL_EQUIVALENTS[t] ?? ""));
    if (tokens.length === 0) continue;

    networkTokenMap.push({
      network: network.key as NetworkKey,
      tokens: tokens as TokenSymbol[],
      family: network.ecosystem,
    });
  }

  return {
    vendorIdentifier: raw.vendorIdentifier,
    businessName: raw.businessName,
    enabledNetworks: networkTokenMap.map((n) => n.network),
    networkTokenMap,
    hasEvmWallet: raw.hasEvmWallet,
    hasSuiWallet: raw.hasSuiWallet,
    hasStellarWallet: raw.hasStellarWallet,
    hasNearWallet: raw.hasNearWallet,
  };
}
