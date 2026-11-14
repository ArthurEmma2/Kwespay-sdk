import { KwesPayError } from "../../types/index.js";

function encodeArgs(args: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function query(rpcUrl: string, params: Record<string, unknown>): Promise<any> {
  let body: any;
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "kwespay", method: "query", params: { finality: "final", ...params } }),
    });
    body = await res.json();
  } catch (err) {
    throw new KwesPayError(`Could not reach the NEAR RPC at ${rpcUrl}.`, "NETWORK_ERROR", err);
  }
  if (body?.error) {
    const cause = body.error?.cause?.name ?? body.error?.data ?? body.error?.message;
    throw new KwesPayError(`NEAR RPC error: ${typeof cause === "string" ? cause : JSON.stringify(cause)}`, "NETWORK_ERROR", body.error);
  }
  return body.result;
}

export async function nearView<T>(
  rpcUrl: string,
  accountId: string,
  methodName: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const result = await query(rpcUrl, {
    request_type: "call_function",
    account_id: accountId,
    method_name: methodName,
    args_base64: encodeArgs(args),
  });
  const text = new TextDecoder().decode(new Uint8Array(result.result ?? []));
  return (text ? JSON.parse(text) : null) as T;
}

export async function nearAvailableBalance(rpcUrl: string, accountId: string): Promise<bigint> {
  const account = await query(rpcUrl, { request_type: "view_account", account_id: accountId });
  const storage = BigInt(account.storage_usage ?? 0) * 10_000_000_000_000_000_000n;
  const available = BigInt(account.amount) - storage;
  return available > 0n ? available : 0n;
}
