import {
  NetworkKey,
  TokenSymbol,
  NetworkTokenConfig,
  MerchantConfig,
} from "../types/index.js";
import { isSuiNetwork, isStellarNetwork } from "../internal/config.js";

const CANONICAL_EQUIVALENTS: Record<string, string> = {
  "USDC.E": "USDC",
  USDBC: "USDC",
};

// All tokens the KwesPay backend supports on each network.
const BACKEND_NETWORK_TOKENS: Partial<Record<NetworkKey, TokenSymbol[]>> = {
  ethereum: ["ETH", "USDT", "USDC", "DAI"],
  sepolia: ["ETH", "USDT", "MUSD"],
  base: ["ETH", "USDC", "USDBC", "USDT"],
  baseSepolia: ["ETH", "USDC"],
  polygon: ["MATIC", "USDT", "USDC", "USDC.E"],
  polygonAmoy: ["MATIC", "USDT", "USDC"],
  lisk: ["ETH", "USDC.E", "USDT", "LSK"],
  liskTestnet: ["ETH", "LSK"],
  mezo: ["BTC", "MEZO"],
  mezoTestnet: ["BTC", "MEZO", "MUSD", "USDT"],
  arbitrum: ["ETH", "USDC", "USDT"],
  arbitrumSepolia: ["ETH", "USDC", "ARB"],
  suiTestnet: ["SUI", "USDC"],
  suiMainnet: ["SUI"],
  stellarTestnet: ["XLM", "USDC"],
  stellarMainnet: ["XLM", "USDC"],
};

export function buildMerchantConfig(raw: {
  vendorIdentifier: string;
  businessName: string;
  enabledNetworks: string[];
  acceptedCurrencies: string[];
  hasEvmWallet: boolean;
  hasSuiWallet: boolean;
  hasStellarWallet: boolean;
}): MerchantConfig {
  const acceptedSet = new Set(
    raw.acceptedCurrencies.map((t) => t.toUpperCase()),
  );

  const networkTokenMap: NetworkTokenConfig[] = [];

  for (const network of raw.enabledNetworks as NetworkKey[]) {
    const sui = isSuiNetwork(network);
    const stellar = isStellarNetwork(network);

    if (sui && !raw.hasSuiWallet) continue;
    if (stellar && !raw.hasStellarWallet) continue;
    if (!sui && !stellar && !raw.hasEvmWallet) continue;

    const backendTokens = BACKEND_NETWORK_TOKENS[network];
    if (!backendTokens || backendTokens.length === 0) continue;

    const tokens = backendTokens.filter((t) => {
      if (acceptedSet.has(t)) return true;
      const canonical = CANONICAL_EQUIVALENTS[t];
      return canonical ? acceptedSet.has(canonical) : false;
    });
    if (tokens.length === 0) continue;

    networkTokenMap.push({
      network,
      tokens,
      family: sui ? "sui" : stellar ? "stellar" : "evm",
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
  };
}

/**
 * Validate that a network+token combination is enabled for a merchant.
 * Returns null if valid, or a developer-facing error string if not.
 */
export function validateNetworkToken(
  config: MerchantConfig,
  network: NetworkKey,
  token: TokenSymbol,
): string | null {
  const entry = config.networkTokenMap.find((n) => n.network === network);

  if (!entry) {
    const isEnabled = (config.enabledNetworks as string[]).includes(network);
    if (!isEnabled) {
      return (
        `Network "${network}" is not enabled for vendor "${config.vendorIdentifier}". ` +
        `Enabled networks: [${config.enabledNetworks.join(", ")}]. ` +
        "The vendor must enable this network in their KwesPay dashboard."
      );
    }

    const sui = isSuiNetwork(network);
    const stellar = isStellarNetwork(network);
    const hasWallet = sui
      ? config.hasSuiWallet
      : stellar
        ? config.hasStellarWallet
        : config.hasEvmWallet;
    const familyLabel = sui ? "Sui" : stellar ? "Stellar" : "EVM";

    if (!hasWallet) {
      return (
        `Vendor "${config.vendorIdentifier}" has no ${familyLabel} wallet configured. ` +
        `A ${familyLabel} wallet is required to accept payments on "${network}".`
      );
    }

    const backendTokens = BACKEND_NETWORK_TOKENS[network] ?? [];
    return (
      `Network "${network}" is enabled but no accepted currencies overlap with ` +
      `tokens supported on that network. ` +
      `Vendor accepts: [${Array.from(
        new Set(config.networkTokenMap.flatMap((n) => n.tokens)),
      ).join(", ")}]. ` +
      `Supported on "${network}": [${backendTokens.join(", ")}].`
    );
  }

  const tokenUpper = token.toUpperCase();
  const tokenMatch = entry.tokens.find((t) => t.toUpperCase() === tokenUpper);
  if (!tokenMatch) {
    return (
      `Token "${token}" is not accepted by vendor "${config.vendorIdentifier}" on "${network}". ` +
      `Accepted tokens on "${network}": [${entry.tokens.join(", ")}]. ` +
      "Ensure the vendor has added this token in their acceptedCurrencies."
    );
  }

  return null;
}
