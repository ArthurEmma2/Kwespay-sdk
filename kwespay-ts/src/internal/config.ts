import type { NetworkKey } from "../types/index.js";

export const ENDPOINT = "https://ad30-154-161-173-138.ngrok-free.app/graphql";

const TESTNET_CONTRACTS: Partial<Record<NetworkKey, string>> = {
  sepolia: "0xD9312df771aEf74a6748c0C46A706873C67F44C7",
  baseSepolia: "0x3d7A6a7aD72374D2d3dca4e97053bAbFA6E49ec0",
  polygonAmoy: "0xEb40935599d5D8ef39C1aAE38E7A1f6d9c89B3fF",
  liskTestnet: "0x3378B6074A9DA47Aef8b7C849aFcaF58b8D8134b",
  mezoTestnet: "0x67f3Df6B5BE714303F397104d8F2A3861b9E8b6d",
};


const MAINNET_CONTRACTS: Partial<Record<NetworkKey, string>> = {
  // lisk: "0x...",
};

const CONTRACT_ADDRESSES: Partial<Record<NetworkKey, string>> = {
  ...TESTNET_CONTRACTS,
  ...MAINNET_CONTRACTS,
};

export function resolveContractAddress(network: NetworkKey): string {
  const addr = CONTRACT_ADDRESSES[network];
  if (!addr) throw new Error(`No contract deployed on network: ${network}`);
  return addr;
}
