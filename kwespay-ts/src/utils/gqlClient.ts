import { KwesPayError } from "../types/index.js";
import { ENDPOINT } from "../internal/config.js";

interface GQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function gqlRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  apiKey?: string
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["X-API-Key"] = apiKey;

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new KwesPayError(
      "Network request failed — check your connectivity",
      "NETWORK_ERROR",
      err
    );
  }

  if (!response.ok) {
    throw new KwesPayError(
      `HTTP ${response.status}: ${response.statusText}`,
      "NETWORK_ERROR"
    );
  }

  const json: GQLResponse<T> = await response.json();

  if (json.errors?.length) {
    throw new KwesPayError(
      json.errors[0]?.message ?? "GraphQL error",
      "UNKNOWN"
    );
  }

  if (!json.data) {
    throw new KwesPayError("Empty response from server", "UNKNOWN");
  }

  return json.data;
}
