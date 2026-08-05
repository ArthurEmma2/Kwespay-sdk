
export function extractErrorMessage(err: unknown): string {
  if (err === null || err === undefined) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e["message"] === "string") return e["message"];
    if (typeof e["shortMessage"] === "string") return e["shortMessage"];
    const data = e["data"];
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (typeof d["message"] === "string") return d["message"];
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "Contract error";
    }
  }
  return String(err);
}

export function decodeRevertReason(hex: string): string | null {
  try {
    if (!hex || hex === "0x") return null;
    const ERROR_SELECTOR = "08c379a0";
    if (!hex.startsWith("0x" + ERROR_SELECTOR)) {
      return `raw revert: ${hex.slice(0, 66)}`;
    }
    const data = hex.slice(10); // strip 0x + 4-byte selector
    const offset = parseInt(data.slice(0, 64), 16) * 2;
    const length = parseInt(data.slice(offset, offset + 64), 16) * 2;
    const msgHex = data.slice(offset + 64, offset + 64 + length);
    const bytes = new Uint8Array(
      msgHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}


export function extractRevertHex(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  const inner = e["error"] as Record<string, unknown> | undefined;
  const innerData = inner?.["data"];

  return (
    (typeof e["data"] === "string" ? e["data"] : undefined) ||
    (typeof inner?.["data"] === "string"
      ? (inner["data"] as string)
      : undefined) ||
    (typeof innerData === "object" && innerData !== null
      ? ((innerData as Record<string, unknown>)["data"] as string | undefined)
      : undefined) ||
    (typeof (e["cause"] as Record<string, unknown> | undefined)?.["data"] ===
    "string"
      ? ((e["cause"] as Record<string, unknown>)["data"] as string)
      : undefined)
  );
}

/** Return true if the error represents a user rejection / cancellation. */
export function isUserRejection(err: unknown): boolean {
  const msg = extractErrorMessage(err).toLowerCase();
  return (
    msg.includes("rejected") ||
    msg.includes("denied") ||
    msg.includes("action_rejected") ||
    msg.includes("user denied") ||
    msg.includes("cancelled") ||
    msg.includes("cancel")
  );
}
