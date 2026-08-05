

import { KwesPayError } from "../types/index.js";
import { NetworkKey } from "../types/index.js";

const DEFAULT_FEE_BPS = 50n; // 0.50 %
const FEE_BPS_OVERRIDES: Partial<Record<NetworkKey, bigint>> = {
  stellarMainnet: 100n, // 1%
  stellarTestnet: 25n, // 0.25%
};
const BASIS_POINTS = 10_000n;

function feeBpsFor(network?: NetworkKey): bigint {
  if (!network) return DEFAULT_FEE_BPS;
  return FEE_BPS_OVERRIDES[network] ?? DEFAULT_FEE_BPS;
}


export function computeFee(
  amountBaseUnits: string,
  network?: NetworkKey
): bigint {
  return (BigInt(amountBaseUnits) * feeBpsFor(network)) / BASIS_POINTS;
}


export function computeTotal(
  amountBaseUnits: string,
  network?: NetworkKey
): string {
  return (
    BigInt(amountBaseUnits) + computeFee(amountBaseUnits, network)
  ).toString();
}


export function deriveFee(
  totalBaseUnits: string,
  amountBaseUnits: string
): string {
  const total = BigInt(totalBaseUnits);
  const amount = BigInt(amountBaseUnits);
  if (total < amount) {
    throw new KwesPayError(
      `Invalid amounts: totalBaseUnits (${totalBaseUnits}) < amountBaseUnits (${amountBaseUnits})`,
      "TRANSACTION_FAILED"
    );
  }
  return (total - amount).toString();
}
