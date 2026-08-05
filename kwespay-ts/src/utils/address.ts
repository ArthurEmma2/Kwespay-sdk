

import { KwesPayError } from "../types/index.js";



const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const EVM_ZERO = "0x0000000000000000000000000000000000000000";

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS_RE.test(value);
}

export function isZeroAddress(value: string): boolean {
  return value === EVM_ZERO || value === "0x0";
}

/** Return value with 0x prefix, throws on invalid EVM address. */
export function normaliseEvmAddress(value: string): `0x${string}` {
  const prefixed = value.startsWith("0x") ? value : `0x${value}`;
  if (!isEvmAddress(prefixed)) {
    throw new KwesPayError(
      `Invalid EVM address: "${value}"`,
      "TRANSACTION_FAILED"
    );
  }
  return prefixed as `0x${string}`;
}


export function ensure0x(hex: string): `0x${string}` {
  return (hex.startsWith("0x") ? hex : `0x${hex}`) as `0x${string}`;
}


const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;

export function isSuiAddress(value: string): boolean {
  return SUI_ADDRESS_RE.test(value);
}

/** Normalise a Sui address to its canonical 0x-prefixed 64-hex-char form. */
export function normaliseSuiAddress(value: string): string {
  const raw = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{1,64}$/.test(raw)) {
    throw new KwesPayError(
      `Invalid Sui address: "${value}"`,
      "TRANSACTION_FAILED"
    );
  }
  return "0x" + raw.padStart(64, "0");
}

/** Strip 0x prefix and return raw hex bytes as a number array. */
export function hexToBytes(hex: string): number[] {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new KwesPayError(
      `Hex string has odd length: "${hex}"`,
      "TRANSACTION_FAILED"
    );
  }
  const result: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    result.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return result;
}


export function assertSuiVendorWallet(
  value: string | null | undefined,
  context: string
): asserts value is string {
  if (!value || !isSuiAddress(value)) {
    throw new KwesPayError(
      `${context}: expected a valid Sui wallet address but got "${
        value ?? "null"
      }". ` +
        "Ensure the vendor has a Sui wallet configured and that vendorSuiWallet " +
        "is present in the TransactionPayload.",
      "TRANSACTION_FAILED"
    );
  }
}
