import {
  KwesPayError,
  EVMNetworkKey,
  SuiNetworkKey,
  SuiNetworkConfig,
  StellarNetworkKey,
  StellarNetworkConfig,
} from "../types/index.js";

export const ENDPOINT = "https://api.kwespay.xyz/graphql";

let _endpoint: string = ENDPOINT;

/**
 * Override the GraphQL endpoint at runtime. Called automatically from
 * KwesPayClient when graphqlEndpoint is passed in config.
 */
export function configureEndpoint(url?: string): void {
  if (url) _endpoint = url;
}

export function getEndpoint(): string {
  return _endpoint;
}

const TESTNET_CONTRACTS: Partial<Record<EVMNetworkKey, string>> = {
  sepolia: "0xD9312df771aEf74a6748c0C46A706873C67F44C7",
  baseSepolia: "0x3d7A6a7aD72374D2d3dca4e97053bAbFA6E49ec0",
  polygonAmoy: "0xEb40935599d5D8ef39C1aAE38E7A1f6d9c89B3fF",
  liskTestnet: "0x3378B6074A9DA47Aef8b7C849aFcaF58b8D8134b",
  mezoTestnet: "0x67f3Df6B5BE714303F397104d8F2A3861b9E8b6d", // fixed: Be → BE
  arbitrumSepolia: "0xa430B2e0D1273464809f8541286058e90781DA9C",
};

const MAINNET_CONTRACTS: Partial<Record<EVMNetworkKey, string>> = {
  ethereum: "0x89840Ccfb80cc945DF1009BbB214ffBCE3D9162c",
  polygon: "0xaD93fCF21c9F75d94B551a5e0eb1E0855ACe2f6C",
  base: "0xaD93fCF21c9F75d94B551a5e0eb1E0855ACe2f6C",
  lisk: "0xaD93fCF21c9F75d94B551a5e0eb1E0855ACe2f6C",
  arbitrum: "0xc00d649903aa8834FE04d1aE548Bf86C5928B6B7",
};

const CONTRACT_ADDRESSES: Partial<Record<EVMNetworkKey, string>> = {
  ...TESTNET_CONTRACTS,
  ...MAINNET_CONTRACTS,
};

export function resolveContractAddress(network: string): string {
  const addr = CONTRACT_ADDRESSES[network as EVMNetworkKey];
  if (!addr) {
    throw new KwesPayError(
      `No contract address configured for EVM network "${network}". ` +
        "Check that you are using a supported network key.",
      "CONTRACT_ERROR",
    );
  }
  return addr;
}

let _suiConfigs: Partial<Record<string, SuiNetworkConfig>> = {
  suiTestnet: {
    packageId:
      "0xa47e90a44aac41d1e2dca2fe11169f1e67bdd071b242ea3cbcad1a8b4290875f",
    registryObjectId:
      "0x1d34689e7090813f8d32cb7e784ab45c6e0afc134993bff95844b440525049d9",
  },
  suiMainnet: {
    packageId: "",
    registryObjectId: "",
  },
};

/**
 * Set Sui network object IDs at runtime.
 * Called automatically from KwesPayClient when suiNetworks is passed in config.
 *
 * @example
 * configureSui({
 *   suiTestnet: {
 *     packageId:        "0xabc...",
 *     registryObjectId: "0xdef...",
 *   },
 * });
 */
export function configureSui(
  configs: Partial<Record<string, SuiNetworkConfig>>,
): void {
  _suiConfigs = { ..._suiConfigs, ...configs };
}

export function resolveSuiConfig(network: string): SuiNetworkConfig {
  const cfg = _suiConfigs[network];
  if (!cfg?.packageId || !cfg?.registryObjectId) {
    throw new KwesPayError(
      `Sui network "${network}" is not configured. ` +
        `Call configureSui({ ${network}: { packageId, registryObjectId } }) ` +
        "or pass suiNetworks in KwesPayConfig before making Sui payments.",
      "CONTRACT_ERROR",
    );
  }
  return cfg;
}

const SUI_NETWORK_SET = new Set<string>(["suiTestnet", "suiMainnet"]);

export function isSuiNetwork(network: string): network is SuiNetworkKey {
  return SUI_NETWORK_SET.has(network);
}

const STELLAR_NETWORK_SET = new Set<string>([
  "stellarTestnet",
  "stellarMainnet",
]);

export function isStellarNetwork(
  network: string,
): network is StellarNetworkKey {
  return STELLAR_NETWORK_SET.has(network);
}

const STELLAR_NETWORK_PASSPHRASES: Record<string, string> = {
  stellarTestnet: "Test SDF Network ; September 2015",
  stellarMainnet: "Public Global Stellar Network ; September 2015",
};

const DEFAULT_STELLAR_RPC_URLS: Record<string, string> = {
  stellarTestnet: "https://soroban-testnet.stellar.org",
  stellarMainnet: "https://mainnet.sorobanrpc.com",
};

let _stellarConfigs: Partial<Record<string, StellarNetworkConfig>> = {
  stellarTestnet: {
    contractId: "CBS6TTZ56NSZLH2PSGA4VHNEBDX6JQV3S2J36KVKTWJ55TK7RN2U7IS5",
    rpcUrl: DEFAULT_STELLAR_RPC_URLS.stellarTestnet,
  },
  stellarMainnet: {
    contractId: "CD4PCXKGYXYQKW3NXKQNKLBM2XML6HKHKQ2CTPBTVAGQGPPKTHCWKXTC",
    rpcUrl: DEFAULT_STELLAR_RPC_URLS.stellarMainnet,
  },
};

/**
 * Set Stellar contract IDs at runtime. Called automatically from
 * KwesPayClient when stellarNetworks is passed in config.
 *
 * @example
 * configureStellar({
 *   stellarMainnet: { contractId: "C..." },
 * });
 */
export function configureStellar(
  configs: Partial<Record<string, StellarNetworkConfig>>,
): void {
  _stellarConfigs = { ..._stellarConfigs, ...configs };
}

export function resolveStellarNetworkConfig(network: string): {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
} {
  const passphrase = STELLAR_NETWORK_PASSPHRASES[network];
  if (!passphrase) {
    throw new KwesPayError(
      `"${network}" is not a recognised Stellar network.`,
      "CONTRACT_ERROR",
    );
  }

  const cfg = _stellarConfigs[network];
  if (!cfg?.contractId) {
    throw new KwesPayError(
      `Stellar network "${network}" is not configured — missing contractId. ` +
        `Call configureStellar({ ${network}: { contractId: "C..." } }) ` +
        "or pass stellarNetworks in KwesPayConfig before making Stellar payments.",
      "CONTRACT_ERROR",
    );
  }

  return {
    contractId: cfg.contractId,
    rpcUrl: cfg.rpcUrl || DEFAULT_STELLAR_RPC_URLS[network],
    networkPassphrase: passphrase,
  };
}
