#!/usr/bin/env node

const ENDPOINT = "https://f433-154-161-230-28.ngrok-free.app/graphql";
const API_KEY  = "pk_9zmMNf9R5SzXbZE3ktBjl6cBNV9qBjxqDuczUg8lcTQ";
const VENDOR_ID = "0276c40a-d21e-4983-9096-c668e1659ef9";

// ── config ────────────────────────────────────────────────────────────────────
const QUOTE = {
  fiatAmount:      10,
  fiatCurrency:    "USD",
  cryptoCurrency:  "ETH",
  network:         "sepolia",
};

const PAYER_WALLET = "0x6200cb821Fa0895ce7389a622A30eE3CE6D03D17";
// ─────────────────────────────────────────────────────────────────────────────

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
};

function log(label, value, color = c.reset) {
  const pad = label.padEnd(24);
  console.log(`  ${c.dim}${pad}${c.reset}${color}${value}${c.reset}`);
}

function section(title) {
  console.log(`\n${c.bold}${c.cyan}── ${title} ${"─".repeat(Math.max(0, 48 - title.length))}${c.reset}`);
}

function ok(msg)   { console.log(`  ${c.green}✓${c.reset} ${msg}`); }
function fail(msg) { console.log(`  ${c.red}✗${c.reset} ${msg}`); }
function warn(msg) { console.log(`  ${c.yellow}!${c.reset} ${msg}`); }

async function gql(query, variables = {}, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error("Empty response");
  return json.data;
}

// ── queries ───────────────────────────────────────────────────────────────────

const Q_VALIDATE_KEY = `
  query ValidateAccessKey($accessKey: String!) {
    validateAccessKey(accessKey: $accessKey) {
      isValid keyId keyLabel activeFlag expirationDate
      vendorInfo { vendorPk vendorIdentifier businessName }
      allowedVendors allowedNetworks allowedTokens error
    }
  }
`;

const M_CREATE_QUOTE = `
  mutation CreateQuote($input: CreateQuoteInput!) {
    createQuote(input: $input) {
      success message quoteId quoteReference
      cryptoCurrency tokenAddress amountBaseUnits
      displayAmount network chainId expiresAt
    }
  }
`;

const M_CREATE_TX = `
  mutation CreateTransaction($input: CreateTransactionInput!) {
    createTransaction(input: $input) {
      success message paymentIdBytes32 backendSignature
      tokenAddress amountBaseUnits chainId expiresAt
      transaction { transactionReference transactionStatus }
    }
  }
`;

const Q_STATUS = `
  query GetTransactionStatus($transactionReference: String!) {
    getTransactionStatus(transactionReference: $transactionReference) {
      transactionReference transactionStatus blockchainHash
      blockchainNetwork displayAmount cryptoCurrency
      payerWalletAddress initiatedAt
    }
  }
`;

// ── steps ─────────────────────────────────────────────────────────────────────

async function stepValidateKey() {
  section("1 · validate_key");
  const data = await gql(Q_VALIDATE_KEY, { accessKey: API_KEY });
  const r = data.validateAccessKey;

  log("is_valid",    String(r.isValid),      r.isValid ? c.green : c.red);
  log("key_id",      String(r.keyId ?? "—"));
  log("key_label",   r.keyLabel ?? "—");
  log("active",      String(r.activeFlag),   r.activeFlag ? c.green : c.yellow);
  log("expires",     r.expirationDate ?? "never");
  log("vendor",      r.vendorInfo?.businessName ?? "—");
  log("vendor_id",   r.vendorInfo?.vendorIdentifier ?? "—");
  log("networks",    (r.allowedNetworks ?? ["all"]).join(", "), c.gray);
  log("tokens",      (r.allowedTokens   ?? ["all"]).join(", "), c.gray);

  if (!r.isValid) {
    fail(`Key invalid: ${r.error}`);
    process.exit(1);
  }
  ok("Key valid");
  return r;
}

async function stepCreateQuote() {
  section("2 · create_quote");
  log("vendor_id",    VENDOR_ID, c.gray);
  log("fiat",         `${QUOTE.fiatAmount} ${QUOTE.fiatCurrency}`, c.gray);
  log("crypto",       QUOTE.cryptoCurrency, c.gray);
  log("network",      QUOTE.network, c.gray);

  const data = await gql(
    M_CREATE_QUOTE,
    {
      input: {
        vendorIdentifier: VENDOR_ID,
        fiatAmount:       QUOTE.fiatAmount,
        fiatCurrency:     QUOTE.fiatCurrency,
        cryptoCurrency:   QUOTE.cryptoCurrency,
        network:          QUOTE.network,
      },
    },
    API_KEY
  );
  const q = data.createQuote;

  if (!q.success) {
    fail(q.message);
    process.exit(1);
  }

  const fee   = (BigInt(q.amountBaseUnits) * 50n) / 10000n;
  const total = BigInt(q.amountBaseUnits) + fee;

  log("quote_id",         String(q.quoteId),        c.yellow);
  log("quote_reference",  q.quoteReference ?? "—",  c.gray);
  log("network",          q.network);
  log("chain_id",         String(q.chainId));
  log("token_address",    q.tokenAddress);
  log("display_amount",   `${q.displayAmount} ${q.cryptoCurrency}`);
  log("amount_base_units",q.amountBaseUnits);
  log("fee (0.5%)",       fee.toString(),            c.gray);
  log("total_base_units", total.toString(),          c.cyan);
  log("expires_at",       q.expiresAt ? new Date(q.expiresAt).toISOString() : "—");

  ok(`Quote created — id=${q.quoteId}`);
  return q;
}

async function stepCreateTransaction(quoteId) {
  section("3 · create_transaction");
  log("quote_id",      String(quoteId),  c.gray);
  log("payer_wallet",  PAYER_WALLET,     c.gray);

  const data = await gql(
    M_CREATE_TX,
    {
      input: {
        quoteId,
        payerWalletAddress: PAYER_WALLET,
      },
    },
    API_KEY
  );
  const t = data.createTransaction;

  if (!t.success) {
    fail(t.message);
    process.exit(1);
  }

  log("tx_reference",      t.transaction?.transactionReference, c.yellow);
  log("tx_status",         t.transaction?.transactionStatus);
  log("chain_id",          String(t.chainId));
  log("token_address",     t.tokenAddress);
  log("amount_base_units", t.amountBaseUnits);
  log("payment_id_bytes32",t.paymentIdBytes32);
  log("backend_signature", t.backendSignature ? t.backendSignature.slice(0, 20) + "…" : "—");
  log("expires_at",        t.expiresAt ? new Date(t.expiresAt).toISOString() : "—");

  ok(`Transaction created — ref=${t.transaction?.transactionReference}`);
  return t;
}

async function stepGetStatus(transactionReference) {
  section("4 · get_status");
  log("reference", transactionReference, c.gray);

  const data = await gql(Q_STATUS, { transactionReference });
  const r = data.getTransactionStatus;

  const statusColor = {
    completed:  c.green,
    failed:     c.red,
    expired:    c.red,
    pending:    c.yellow,
    processing: c.yellow,
    underpaid:  c.red,
    overpaid:   c.yellow,
    refunded:   c.yellow,
  };

  log("status",       r.transactionStatus, statusColor[r.transactionStatus] ?? c.reset);
  log("network",      r.blockchainNetwork ?? "—");
  log("amount",       `${r.displayAmount} ${r.cryptoCurrency}`);
  log("payer",        r.payerWalletAddress ?? "—");
  log("tx_hash",      r.blockchainHash ?? "—");
  log("initiated_at", r.initiatedAt ? new Date(r.initiatedAt).toISOString() : "—");

  ok(`Status fetched — ${r.transactionStatus}`);
  return r;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold}KwesPay API Test${c.reset}`);
  console.log(`${c.gray}endpoint: ${ENDPOINT}${c.reset}`);
  console.log(`${c.gray}key:      ${API_KEY.slice(0, 12)}…${c.reset}`);

  try {
    await stepValidateKey();
    const quote = await stepCreateQuote();
    const tx    = await stepCreateTransaction(quote.quoteId);

    if (tx.transaction?.transactionReference) {
      await stepGetStatus(tx.transaction.transactionReference);
    }

    section("done");
    ok("All steps passed");
    console.log();

  } catch (err) {
    section("error");
    fail(err.message);
    if (process.env.DEBUG) console.error(err);
    console.log();
    process.exit(1);
  }
}

main();
