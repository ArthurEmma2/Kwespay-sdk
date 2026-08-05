# @kwespay/client

TypeScript SDK for [KwesPay](https://www.kwespay.xyz/) — accept crypto payments in your app with minimal setup.

All pricing, signing, and contract addresses are managed server-side. You initialise the client, request a quote, and execute the payment. Nothing else is required.

---

## Prerequisites

Before installing the SDK, you need a KwesPay vendor account and an API key.

1. Go to [app.kwespay.xyz](https://app.kwespay.xyz) and create an account
2. Create a vendor profile — this gives you your **Vendor ID**
3. Navigate to **API Keys** and generate a key — this is your **API Key**

Keep both values handy; you will need them to initialise the client.

---

## Installation

```bash
npm install @kwespay/client
```

```bash
yarn add @kwespay/client
```

```bash
pnpm add @kwespay/client
```

---

## Requirements

- Node.js 18+
- TypeScript 5+
- An EIP-1193 compatible wallet provider (MetaMask, WalletConnect, etc.)
- A KwesPay API key (see [Prerequisites](#prerequisites))

---

## Quick Start

```typescript
import { KwesPayClient } from "@kwespay/client";

const client = new KwesPayClient({ apiKey: "your-api-key" });

const payload = await client.quote({
  vendorIdentifier: "your-vendor-id",
  fiatAmount: 10,
  fiatCurrency: "USD",
  cryptoCurrency: "USDC",
  network: "base",
  payerWalletAddress: "0xabc...",
});

const result = await client.pay({
  provider: window.ethereum,
  payload,
  onStatus: (title, detail) => console.log(title, detail),
});

console.log(result.txHash);
```

The example above hardcodes `payerWalletAddress`. In a real app you get that address by connecting to the user's wallet first — see [Connecting a Wallet](#connecting-a-wallet) below for the full flow.

---

## Connecting a Wallet

`client.pay()` takes a wallet **provider**, not a private key — the SDK never touches keys and never signs anything itself. Every signature (token approval, the payment transaction) is requested through the wallet extension, which prompts the user and returns the signed, broadcast result. Your app's job is just to:

1. Detect an injected wallet (MetaMask, or any [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193)-compatible provider)
2. Request the connected account (`eth_requestAccounts`)
3. Pass that address to `client.quote()`, and the provider itself to `client.pay()`

Everything else — chain switching, ERC-20 approval, transaction submission — happens automatically inside `pay()`.

### What triggers a wallet popup

| Step | When it happens | Skipped when |
|---|---|---|
| Connect | `eth_requestAccounts` is called | Wallet already connected to your site |
| Network switch | Wallet is on the wrong chain for `payload.network` | Wallet already on the correct chain |
| Token approval | Paying with an ERC-20 and current allowance < amount | Paying with the native coin, or allowance is already sufficient |
| Payment transaction | Always, right before funds move | Never |

### Vanilla JavaScript

Works with plain `<script type="module">`, Vite, webpack, or any other bundler — no TypeScript required.

```html
<!DOCTYPE html>
<html>
  <body>
    <button id="connect">Connect Wallet</button>
    <button id="pay" disabled>Pay $10</button>
    <p id="status"></p>

    <script type="module">
      import { KwesPayClient, KwesPayError } from "@kwespay/client";

      const client = new KwesPayClient({ apiKey: "your-api-key" });

      const connectBtn = document.getElementById("connect");
      const payBtn = document.getElementById("pay");
      const statusEl = document.getElementById("status");

      let walletAddress = null;

      function shortAddress(addr) {
        return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
      }

      async function connectWallet() {
        if (!window.ethereum) {
          alert("No wallet found. Install MetaMask: https://metamask.io/download");
          return;
        }

        try {
          const accounts = await window.ethereum.request({
            method: "eth_requestAccounts",
          });
          walletAddress = accounts[0];
          connectBtn.textContent = shortAddress(walletAddress);
          payBtn.disabled = false;
        } catch (err) {
          // 4001 is the standard EIP-1193 "user rejected request" code.
          statusEl.textContent =
            err.code === 4001
              ? "Connection request rejected."
              : `Failed to connect: ${err.message}`;
        }
      }

      // Keep the UI in sync if the user switches accounts or disconnects
      // from inside the wallet itself, rather than through your app.
      window.ethereum?.on("accountsChanged", (accounts) => {
        walletAddress = accounts[0] ?? null;
        payBtn.disabled = !walletAddress;
        connectBtn.textContent = walletAddress
          ? shortAddress(walletAddress)
          : "Connect Wallet";
      });

      async function payNow() {
        payBtn.disabled = true;
        try {
          const payload = await client.quote({
            vendorIdentifier: "your-vendor-id",
            fiatAmount: 10,
            fiatCurrency: "USD",
            cryptoCurrency: "USDC",
            network: "base",
            payerWalletAddress: walletAddress,
          });

          // pay() prompts the wallet for approval (if needed) and the
          // payment transaction itself — both are real signatures the
          // user confirms in MetaMask.
          const result = await client.pay({
            provider: window.ethereum,
            payload,
            onStatus: (title, detail) => {
              statusEl.textContent = `${title}: ${detail}`;
            },
          });

          statusEl.textContent = `Paid! Tx: ${result.txHash}`;
        } catch (err) {
          statusEl.textContent =
            err instanceof KwesPayError
              ? `[${err.code}] ${err.message}`
              : String(err);
        } finally {
          payBtn.disabled = false;
        }
      }

      connectBtn.addEventListener("click", connectWallet);
      payBtn.addEventListener("click", payNow);
    </script>
  </body>
</html>
```

> **No bundler?** Load the pre-built browser bundle directly from a CDN:
> ```html
> <script src="https://cdn.jsdelivr.net/npm/@kwespay/client/dist/browser/kwespay.js"></script>
> <script>
>   const client = new KwesPay.KwesPayClient({ apiKey: "your-api-key" });
>   // same connectWallet() / payNow() code as above, using `KwesPay.KwesPayError`
> </script>
> ```
> The CDN build only covers EVM networks. Sui and Stellar payments dynamically load `@mysten/sui` / `@stellar/stellar-sdk`, which requires a bundler that can resolve npm packages — see [Non-EVM wallets](#non-evm-wallets-sui--stellar) below.

### React

```tsx
import { useState, useCallback, useEffect } from "react";
import { KwesPayClient, KwesPayError } from "@kwespay/client";

const client = new KwesPayClient({ apiKey: "your-api-key" });

function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("No wallet found. Install MetaMask.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      setAddress(accounts[0]);
    } catch (err: any) {
      setError(err?.code === 4001 ? "Connection rejected." : err.message);
    } finally {
      setConnecting(false);
    }
  }, []);

  // React never sees wallet-side account/network changes on its own —
  // this keeps `address` correct if the user switches accounts in MetaMask.
  useEffect(() => {
    if (!window.ethereum) return;
    const onAccountsChanged = (accounts: string[]) =>
      setAddress(accounts[0] ?? null);
    window.ethereum.on("accountsChanged", onAccountsChanged);
    return () => window.ethereum?.removeListener("accountsChanged", onAccountsChanged);
  }, []);

  return { address, connect, connecting, error };
}

export function PayButton() {
  const { address, connect, connecting, error } = useWallet();
  const [status, setStatus] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const pay = useCallback(async () => {
    if (!address) return;
    setPaying(true);
    try {
      const payload = await client.quote({
        vendorIdentifier: "your-vendor-id",
        fiatAmount: 10,
        fiatCurrency: "USD",
        cryptoCurrency: "USDC",
        network: "base",
        payerWalletAddress: address,
      });

      const result = await client.pay({
        provider: window.ethereum,
        payload,
        onStatus: (title, detail) => setStatus(`${title}: ${detail}`),
      });

      setStatus(`Paid! Tx: ${result.txHash}`);
    } catch (err) {
      setStatus(err instanceof KwesPayError ? `[${err.code}] ${err.message}` : String(err));
    } finally {
      setPaying(false);
    }
  }, [address]);

  if (!address) {
    return (
      <div>
        <button onClick={connect} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect Wallet"}
        </button>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <button onClick={pay} disabled={paying}>
        {paying ? "Processing…" : "Pay $10"}
      </button>
      {status && <p>{status}</p>}
    </div>
  );
}
```

> **Production tip:** prefer a wallet-connection library — [wagmi](https://wagmi.sh/), [RainbowKit](https://www.rainbowkit.com/), or [Web3Modal](https://web3modal.com/) — over hand-rolled `window.ethereum` calls. They handle multi-wallet detection ([EIP-6963](https://eips.ethereum.org/EIPS/eip-6963), since several extensions can inject `window.ethereum` at once), WalletConnect/mobile deep links, and reconnect-on-refresh for you. Whichever you use, the integration point with KwesPay stays identical: get an EIP-1193 `provider` and an `address`, then call `client.quote()` and `client.pay()` exactly as above.

### TypeScript and `window.ethereum`

TypeScript doesn't know about `window.ethereum` out of the box. Declare it once, project-wide, in a `global.d.ts`:

```typescript
import type { EIP1193Provider } from "@kwespay/client";

declare global {
  interface Window {
    ethereum?: EIP1193Provider & {
      on(event: string, listener: (...args: any[]) => void): void;
      removeListener(event: string, listener: (...args: any[]) => void): void;
    };
  }
}
```

### Non-EVM wallets (Sui / Stellar)

Sui and Stellar use different wallet interfaces — `SuiWalletAdapter` and `StellarWalletAdapter` — instead of `window.ethereum`. You'd typically get these from `@mysten/wallet-standard`-compatible wallets (e.g. Sui Wallet) or `@stellar/freighter-api` (e.g. Freighter), then pass the adapter as `wallet` instead of `provider`:

```typescript
// Sui
const result = await client.pay({ wallet: suiWalletAdapter, payload, onStatus });

// Stellar
const result = await client.pay({ wallet: stellarWalletAdapter, payload, onStatus });
```

`client.pay()` picks the right flow automatically based on `payload.network` — you never need to branch on network type yourself.

---

## API Reference

### `new KwesPayClient(config)`

Creates a new client instance.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `config.apiKey` | `string` | Yes | Your KwesPay API key |

---

### `client.validateKey()`

Validates the configured API key and returns its scope.

```typescript
const result = await client.validateKey();

if (result.isValid) {
  console.log(result.vendorInfo);
  console.log(result.scope.allowedNetworks);
} else {
  console.error(result.error);
}
```

**Returns** — `{ isValid: true, keyId, keyLabel, activeFlag, expirationDate, vendorInfo, scope }` or `{ isValid: false, error }`.

---

### `client.quote(params)`

Fetches a price quote and prepares a transaction payload in a single call. The returned payload is passed directly to `client.pay()`.

```typescript
const payload = await client.quote({
  vendorIdentifier: "your-vendor-id",
  fiatAmount: 25.00,
  fiatCurrency: "USD",        // optional, defaults to "USD"
  cryptoCurrency: "USDC",
  network: "base",
  payerWalletAddress: "0xabc...",
});
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `vendorIdentifier` | `string` | Yes | Your vendor UUID from [app.kwespay.xyz](https://app.kwespay.xyz) |
| `fiatAmount` | `number` | Yes | Amount in fiat to charge |
| `fiatCurrency` | `string` | No | ISO 4217 fiat currency code — see [Supported Fiat Currencies](#supported-fiat-currencies). Defaults to `"USD"` |
| `cryptoCurrency` | `TokenSymbol` | Yes | Token to accept |
| `network` | `NetworkKey` | Yes | Target blockchain network |
| `payerWalletAddress` | `string` | Yes | The payer's wallet address |

**Returns** — `TransactionPayload`

---

### `client.pay(params)`

Executes the on-chain payment. Handles network switching, token approval, and transaction submission automatically.

```typescript
const result = await client.pay({
  provider: window.ethereum,
  payload,
  onStatus: (title, detail) => {
    console.log(`[${title}] ${detail}`);
  },
});
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `provider` | `EIP1193Provider` | Yes | Wallet provider |
| `payload` | `TransactionPayload` | Yes | Payload from `client.quote()` |
| `onStatus` | `(title, detail) => void` | No | Progress callback |

The `onStatus` callback fires at each stage of the payment flow:

| Title | Fired when |
|---|---|
| `Checking balance` | Verifying wallet has sufficient funds |
| `Switching network` | Requesting network change in wallet |
| `Checking approval` | Reading current ERC-20 allowance |
| `Approve token` | Requesting ERC-20 approval from user |
| `Waiting for approval` | Approval tx is confirming on-chain |
| `Confirm payment` | Requesting payment tx from user |
| `Waiting for confirmation` | Payment tx is confirming on-chain |

**Returns** — `PaymentResult`

```typescript
interface PaymentResult {
  txHash: string;
  blockNumber: number;
  transactionReference: string;
  paymentIdBytes32: string;
}
```

---

### `client.getTransactionStatus(transactionReference)`

Polls the KwesPay backend for the current status of a transaction.

```typescript
const status = await client.getTransactionStatus("txn_ref_here");
console.log(status.transactionStatus); // "completed"
```

**Returns** — `TransactionStatusResult`

```typescript
interface TransactionStatusResult {
  transactionReference: string;
  transactionStatus: TransactionStatus;
  blockchainHash: string | null;
  blockchainNetwork: string | null;
  displayAmount: number;
  cryptoCurrency: string;
  payerWalletAddress: string;
  initiatedAt: string;
}
```

---

## Supported Networks

| Key | Network |
|---|---|
| `ethereum` | Ethereum Mainnet |
| `sepolia` | Ethereum Sepolia (testnet) |
| `base` | Base Mainnet |
| `baseSepolia` | Base Sepolia (testnet) |
| `polygon` | Polygon Mainnet |
| `polygonAmoy` | Polygon Amoy (testnet) |
| `lisk` | Lisk Mainnet |
| `liskTestnet` | Lisk Testnet |
| `MezoTestnet` | Mezo Testnet |

---

## Supported Tokens

`ETH`, `MATIC`, `USDT`, `USDC`, `USDC.E`, `USDBC`, `DAI`, `LSK`, `MUSD`

Custom token addresses are also accepted as a plain string.

---

## Supported Fiat Currencies

`fiatAmount`/`fiatCurrency` are quoted server-side against live FX rates, so `fiatCurrency` accepts any standard ISO 4217 code — it isn't limited to the list below. These are the currencies KwesPay actively supports for African markets:

| Code | Currency | Country |
|---|---|---|
| `USD` | US Dollar | — (default) |
| `NGN` | Naira | Nigeria |
| `GHS` | Cedi | Ghana |
| `ZAR` | Rand | South Africa |
| `KES` | Shilling | Kenya |
| `ZWG` | Zimbabwe Gold (ZiG) | Zimbabwe |

```typescript
const payload = await client.quote({
  vendorIdentifier: "your-vendor-id",
  fiatAmount: 5000,
  fiatCurrency: "NGN",
  cryptoCurrency: "USDC",
  network: "base",
  payerWalletAddress: address,
});
```

`fiatCurrency` defaults to `"USD"` if omitted.

---

## Error Handling

All errors are thrown as `KwesPayError` instances with a `code` property.

```typescript
import { KwesPayClient, KwesPayError } from "@kwespay/client";

try {
  const payload = await client.quote({ ... });
  const result = await client.pay({ provider, payload });
} catch (err) {
  if (err instanceof KwesPayError) {
    switch (err.code) {
      case "WALLET_REJECTED":
        console.error("User cancelled the transaction.");
        break;
      case "INSUFFICIENT_BALANCE":
        console.error("Not enough funds:", err.message);
        break;
      case "WRONG_NETWORK":
        console.error("Network mismatch:", err.message);
        break;
      case "QUOTE_EXPIRED":
        console.error("Quote expired. Request a new one.");
        break;
      default:
        console.error(`Payment failed [${err.code}]:`, err.message);
    }
  }
}
```

### Error Codes

| Code | Description |
|---|---|
| `INVALID_KEY` | API key is missing, invalid, or inactive |
| `QUOTE_EXPIRED` | Quote TTL has elapsed |
| `QUOTE_USED` | Quote has already been used for a transaction |
| `QUOTE_NOT_FOUND` | Quote ID does not exist |
| `TRANSACTION_FAILED` | Payload is missing required fields |
| `WALLET_REJECTED` | User rejected the transaction in their wallet |
| `APPROVAL_REJECTED` | User rejected the ERC-20 approval in their wallet |
| `INSUFFICIENT_BALANCE` | Wallet lacks funds or gas |
| `CONTRACT_ERROR` | On-chain call reverted or receipt timed out |
| `WRONG_NETWORK` | Wallet is on the wrong chain and could not switch |
| `NETWORK_ERROR` | HTTP or connectivity failure reaching the API |
| `UNKNOWN` | Unclassified server-side error |

---

## TypeScript

The SDK is written in TypeScript and ships its own types. No additional `@types` packages are required.

Key types exported from the package:

```typescript
import type {
  KwesPayConfig,
  QuoteParams,
  TransactionPayload,
  TransactionStatus,
  TransactionStatusResult,
  PayParams,
  PaymentResult,
  NetworkKey,
  TokenSymbol,
  EIP1193Provider,
  KwesPayErrorCode,
} from "@kwespay/client";
```

---

## License

MIT
