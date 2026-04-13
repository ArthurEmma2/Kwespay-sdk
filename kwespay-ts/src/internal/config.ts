import type { NetworkKey } from "../types/index.js";

export const ENDPOINT = "https://d502-154-161-98-26.ngrok-free.app/graphql";

const TESTNET_CONTRACTS: Partial<Record<NetworkKey, string>> = {
  sepolia: "0x39bE436D6A34d0990cb71c9cBD24a5361d85e00B",
  baseSepolia: "0x7515b1b1BcA33E7a9ccBd5E2b93771884654De77",
  polygonAmoy: "0xD31dF3eBd220Fd3e190A346F8927819295d28980",
  liskTestnet: "0xd04A78a998146EBAD04c2b68E020C06Dc3b3717f",
};

const MAINNET_CONTRACTS: Partial<Record<NetworkKey, string>> = {
  // lisk:     "0x...",
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
