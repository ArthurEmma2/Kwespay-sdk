import { SuiNetworkKey, StellarNetworkKey, NearNetworkKey } from "../types/index.js";

export const ENDPOINT = "https://api.kwespay.xyz/graphql";

export function isSuiNetwork(network: string): network is SuiNetworkKey {
  return /^sui[A-Z]/.test(network);
}

export function isStellarNetwork(network: string): network is StellarNetworkKey {
  return /^stellar[A-Z]/.test(network);
}

export function isNearNetwork(network: string): network is NearNetworkKey {
  return /^near[A-Z]/.test(network);
}
