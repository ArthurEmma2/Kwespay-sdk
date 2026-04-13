# @kwespay-ts/sdk

TypeScript SDK for [KwesPay] — accept crypto payments in your app with minimal setup.

All pricing, signing, and contract addresses are managed server-side. You initialise the client, request a quote, and execute the payment. Nothing else is required.


## Requirements

- Node.js 18+
- TypeScript 5+
- An EIP-1193 compatible wallet provider (MetaMask, WalletConnect, etc.)
- A KwesPay API key

---

## Quick Start
```typescript
import { KwesPayClient } from "kwespay";

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
| `vendorIdentifier` | `string` | Yes | Your vendor UUID |
| `fiatAmount` | `number` | Yes | Amount in fiat to charge |
| `fiatCurrency` | `string` | No | Fiat currency code. Defaults to `"USD"` |
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

---

## Supported Tokens

`ETH`, `MATIC`, `USDT`, `USDC`, `USDC.E`, `USDBC`, `DAI`, `LSK`

Custom token addresses are also accepted as a plain string.

---

## Error Handling

All errors are thrown as `KwesPayError` instances with a `code` property.
```typescript
import { KwesPayClient, KwesPayError } from "kwespay";

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
} from "kwespay";
```

---

## License

MIT