

# KwesPay TypeScript SDK

A lightweight, fully typed TypeScript SDK for integrating blockchain payments with **KwesPay**. It provides a simple and secure interface to the KwesPay GraphQL API for creating, submitting, and tracking crypto payments across Ethereum, Polygon, Lisk, and supported testnets.

---

## Features

• Full TypeScript type safety
• Simple client based API
• Automatic auth token handling
• Public and authenticated endpoints
• Transaction status polling
• Custom error classes
• Zero runtime dependencies
• Tree shakeable and production ready

---

## Installation

```bash
npm install @kwespay/sdk
```

```bash
yarn add @kwespay/sdk
```

```bash
pnpm add @kwespay/sdk
```

---

## Quick Start

```ts
import KwesPayClient from '@kwespay/sdk';

const kwespay = new KwesPayClient({
  apiUrl: 'http://127.0.0.1:8000/graphql'
});

// Create a transaction
const result = await kwespay.transactions.create({
  vendorIdentifier: 'vendor-uuid',
  transactionAmount: 10.5,
  cryptoCurrency: 'USDT',
  payerWalletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  network: 'sepolia'
});

// Poll transaction status
await kwespay.transactions.pollStatus(
  result.transaction.transactionReference,
  {
    interval: 3000,
    onUpdate: tx => console.log(tx.transactionStatus)
  }
);
```

---

## Client Initialization

```ts
const client = new KwesPayClient({
  apiUrl: 'https://api.kwespay.com/graphql',
  authToken: 'optional-token',
  timeout: 30000,
  headers: {
    'X-App-Version': '1.0.0'
  }
});
```

---

## Authentication

```ts
await client.auth.register({
  emailAddress: 'vendor@example.com',
  password: 'secure_password',
  displayName: 'John Doe'
});

await client.auth.login({
  emailAddress: 'vendor@example.com',
  password: 'secure_password'
});

client.auth.logout();
```

```ts
client.isAuthenticated();
```

---

## Vendor Management

```ts
const vendor = await client.vendors.create({
  businessName: 'Coffee Shop',
  businessLocation: 'New York',
  cryptoWalletAddress: '0x...',
  acceptedCurrencies: ['ETH', 'USDT']
});
```

```ts
await client.vendors.update('vendor-uuid', {
  acceptedCurrencies: ['ETH', 'USDT', 'USDC']
});
```

```ts
await client.vendors.registerOnBlockchain({
  vendorIdentifier: 'vendor-uuid',
  businessName: 'Coffee Shop',
  walletAddress: '0x...',
  network: 'sepolia'
});
```

---

## Transactions

### Create Transaction (public)

```ts
const result = await client.transactions.create({
  vendorIdentifier: 'vendor-uuid',
  transactionAmount: 5,
  cryptoCurrency: 'USDT',
  payerWalletAddress: '0x...',
  network: 'sepolia'
});
```

### Submit Signed Transaction Hash

```ts
await client.transactions.submitHash({
  transactionReference: 'transaction-uuid',
  txHash: '0x...'
});
```

### Get Status

```ts
await client.transactions.getStatus('transaction-uuid');
```

### Poll Status

```ts
await client.transactions.pollStatus('transaction-uuid', {
  interval: 3000,
  timeout: 300000
});
```

---

## Access Keys

```ts
const key = await client.accessKeys.generate({
  keyLabel: 'Production Key',
  expirationDate: '2025-12-31T23:59:59Z'
});
```

```ts
await client.accessKeys.update(123, { activeFlag: false });
await client.accessKeys.delete(123);
```

---

## Error Handling

```ts
import { AuthenticationError, NetworkError } from '@kwespay/sdk';

try {
  await client.transactions.create({...});
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error('Login required');
  }
}
```

---

## TypeScript Support

All inputs, responses, enums, and errors are exported.

```ts
import {
  TransactionStatus,
  CryptoCurrency,
  Network
} from '@kwespay/sdk';
```

---

## Development

```bash
git clone https://github.com/kwespay/sdk.git
cd sdk
npm install
npm run build
```

---

## License

MIT License

---



