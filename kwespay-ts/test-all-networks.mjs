#!/usr/bin/env node

const ENDPOINT = "https://ad30-154-161-173-138.ngrok-free.app/graphql";
const API_KEY = "pk_9zmMNf9R5SzXbZE3ktBjl6cBNV9qBjxqDuczUg8lcTQ";
const VENDOR_ID = "0276c40a-d21e-4983-9096-c668e1659ef9";
const PAYER = "0x6200cb821Fa0895ce7389a622A30eE3CE6D03D17";

// ── networks to test ──────────────────────────────────────────────────────────
const NETWORKS = [
  { network: "sepolia", crypto: "ETH", fiat: 5, currency: "USD" },
  { network: "sepolia", crypto: "USDT", fiat: 5, currency: "USD" },
  { network: "baseSepolia", crypto: "ETH", fiat: 5, currency: "USD" },
  { network: "baseSepolia", crypto: "USDC", fiat: 5, currency: "USD" },
  { network: "polygonAmoy", crypto: "MATIC", fiat: 5, currency: "USD" },
  { network: "polygonAmoy", crypto: "USDT", fiat: 5, currency: "USD" },
  { network: "polygonAmoy", crypto: "USDC", fiat: 5, currency: "USD" },
  { network: "liskTestnet", crypto: "ETH", fiat: 5, currency: "USD" },
  { network: "liskTestnet", crypto: "LSK", fiat: 5, currency: "USD" },
  { network: "mezoTestnet", crypto: "BTC", fiat: 5, currency: "USD" },
  { network: "mezoTestnet", crypto: "mUSD", fiat: 5, currency: "USD" },
  { network: "mezoTestnet", crypto: "MEZO", fiat: 5, currency: "USD" },
];

// ── colours ───────────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
};

const tick = `${c.green}✓${c.reset}`;
const cross = `${c.red}✗${c.reset}`;
const dash = `${c.gray}—${c.reset}`;

// ── gql helper ────────────────────────────────────────────────────────────────
async function gql(query, variables = {}, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error("empty response");
  return json.data;
}

// ── queries ───────────────────────────────────────────────────────────────────
const M_QUOTE = `
  mutation CreateQuote($input: CreateQuoteInput!) {
    createQuote(input: $input) {
      success message quoteId quoteReference
      cryptoCurrency tokenAddress amountBaseUnits
      displayAmount network chainId expiresAt
    }
  }
`;

const M_TX = `
  mutation CreateTransaction($input: CreateTransactionInput!) {
    createTransaction(input: $input) {
      success message paymentIdBytes32 backendSignature
      tokenAddress amountBaseUnits chainId expiresAt
      transaction { transactionReference transactionStatus }
    }
  }
`;

// ── test one network/token combo ──────────────────────────────────────────────
async function testCombo({ network, crypto, fiat, currency }) {
  const result = {
    network,
    crypto,
    quoteOk: false,
    txOk: false,
    chainId: null,
    amount: null,
    quoteId: null,
    txRef: null,
    error: null,
  };

  try {
    // step 1 — quote
    const qData = await gql(
      M_QUOTE,
      {
        input: {
          vendorIdentifier: VENDOR_ID,
          fiatAmount: fiat,
          fiatCurrency: currency,
          cryptoCurrency: crypto,
          network,
        },
      },
      API_KEY
    );

    const q = qData.createQuote;
    if (!q.success) throw new Error(`quote: ${q.message}`);

    result.quoteOk = true;
    result.chainId = q.chainId;
    result.amount = `${q.displayAmount} ${q.cryptoCurrency}`;
    result.quoteId = q.quoteId;

    // step 2 — transaction
    const tData = await gql(
      M_TX,
      {
        input: { quoteId: q.quoteId, payerWalletAddress: PAYER },
      },
      API_KEY
    );

    const t = tData.createTransaction;
    if (!t.success) throw new Error(`tx: ${t.message}`);

    result.txOk = true;
    result.txRef = t.transaction?.transactionReference;
  } catch (err) {
    result.error =
      err.message.length > 60 ? err.message.slice(0, 57) + "…" : err.message;
  }

  return result;
}

// ── table renderer ────────────────────────────────────────────────────────────
function pad(str, n, right = false) {
  const s = String(str ?? "");
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, n - stripped.length);
  return right ? " ".repeat(pad) + s : s + " ".repeat(pad);
}

function printTable(rows) {
  const cols = [
    { label: "network", key: "network", w: 14 },
    { label: "token", key: "crypto", w: 6 },
    { label: "chain", key: "chainId", w: 7 },
    { label: "quote", key: "quoteOk", w: 6 },
    { label: "tx", key: "txOk", w: 5 },
    { label: "amount", key: "amount", w: 18 },
    { label: "error", key: "error", w: 40 },
  ];

  const line = cols.map((col) => "─".repeat(col.w + 2)).join("┼");
  const header = cols.map((col) => ` ${pad(col.label, col.w)} `).join("│");

  console.log(`\n┌${line.replace(/┼/g, "┬")}┐`);
  console.log(`│${header}│`);
  console.log(`├${line}┤`);

  for (const row of rows) {
    const cells = cols.map((col) => {
      let val = row[col.key];
      if (col.key === "quoteOk" || col.key === "txOk") {
        val = val ? tick : cross;
      } else if (col.key === "error" && val) {
        val = `${c.red}${val}${c.reset}`;
      } else if (col.key === "amount" && val) {
        val = `${c.cyan}${val}${c.reset}`;
      } else if (col.key === "chain" && val) {
        val = `${c.gray}${val}${c.reset}`;
      } else {
        val = val ?? dash;
      }
      return ` ${pad(val, col.w)} `;
    });
    console.log(`│${cells.join("│")}│`);
  }

  console.log(`└${line.replace(/┼/g, "┴")}┘`);
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}KwesPay — all networks test${c.reset}`);
  console.log(`${c.gray}endpoint : ${ENDPOINT}${c.reset}`);
  console.log(`${c.gray}key      : ${API_KEY.slice(0, 12)}…${c.reset}`);
  console.log(`${c.gray}combos   : ${NETWORKS.length}${c.reset}`);
  console.log(
    `\n${c.dim}running ${NETWORKS.length} tests in parallel…${c.reset}`
  );

  const start = Date.now();
  const results = await Promise.all(NETWORKS.map(testCombo));
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  printTable(results);

  const passed = results.filter((r) => r.quoteOk && r.txOk).length;
  const failed = results.length - passed;

  console.log(
    `\n  ${c.bold}${passed}/${results.length}${c.reset} passed  ${
      failed > 0
        ? `${c.red}${failed} failed${c.reset}`
        : `${c.green}all clear${c.reset}`
    }  ${c.gray}(${elapsed}s)${c.reset}\n`
  );

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\n${c.red}fatal: ${err.message}${c.reset}\n`);
  process.exit(1);
});
