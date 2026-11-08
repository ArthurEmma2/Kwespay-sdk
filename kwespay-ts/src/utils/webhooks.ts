import { KwesPayError, VerifyWebhookOptions, WebhookEvent } from "../types/index.js";

const encoder = new TextEncoder();
const DEFAULT_TOLERANCE_SECONDS = 300;

function fail(message: string): never {
  throw new KwesPayError(message, "WEBHOOK_SIGNATURE_INVALID");
}

function subtle(): SubtleCrypto {
  const globalSubtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!globalSubtle) {
    fail("verifyWebhook() needs Web Crypto: Node.js 20 or later, Deno, Bun, or an edge runtime");
  }
  return globalSubtle;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    else if (key === "v1" && value) signatures.push(value.toLowerCase());
  }
  if (timestamp === undefined || signatures.length === 0) {
    fail("KwesPay-Signature header must contain t= and at least one v1= value");
  }
  return { timestamp, signatures };
}

export async function verifyWebhook<T = WebhookEvent>(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
  options: VerifyWebhookOptions = {}
): Promise<T> {
  if (!secret) fail("A webhook signing secret is required");
  if (!signatureHeader) fail("Missing KwesPay-Signature header");
  if (typeof rawBody !== "string" && !(rawBody instanceof Uint8Array)) {
    fail("Pass the raw request body as a string or Uint8Array, before any JSON parsing");
  }

  const { timestamp, signatures } = parseHeader(signatureHeader);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    fail("Webhook timestamp is outside the allowed tolerance; it may be a replay");
  }

  const body = typeof rawBody === "string" ? encoder.encode(rawBody) : rawBody;
  const prefix = encoder.encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix, 0);
  message.set(body, prefix.length);

  const crypto = subtle();
  const key = await crypto.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.sign("HMAC", key, message));

  let matched = false;
  for (const candidate of signatures) {
    if (constantTimeEqual(candidate, expected)) matched = true;
  }
  if (!matched) fail("Webhook signature does not match");

  const text = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
  try {
    return JSON.parse(text) as T;
  } catch {
    return fail("Webhook body is not valid JSON");
  }
}
