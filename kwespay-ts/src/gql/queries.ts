export const GQL_VALIDATE_KEY = /* GraphQL */ `
  query ValidateAccessKey($accessKey: String!) {
    validateAccessKey(accessKey: $accessKey) {
      isValid
      keyId
      keyLabel
      activeFlag
      expirationDate
      vendorInfo {
        vendorPk
        vendorIdentifier
        businessName
      }
      allowedVendors
      allowedNetworks
      allowedTokens
      error
    }
  }
`;

/**
 * Fetches public vendor data — no auth required.
 * Used by getMerchantConfig() to resolve enabled networks and accepted
 * currencies for a given vendorIdentifier before rendering the widget.
 */
export const GQL_GET_VENDOR = /* GraphQL */ `
  query GetVendor($vendorIdentifier: String!) {
    getVendor(vendorIdentifier: $vendorIdentifier) {
      vendorPk
      vendorIdentifier
      businessName
      acceptedCurrencies
      enabledNetworks
      hasEvmWallet
      hasSuiWallet
      hasStellarWallet
      activeStatus
    }
  }
`;

export const GQL_CREATE_QUOTE = /* GraphQL */ `
  mutation CreateQuote($input: CreateQuoteInput!) {
    createQuote(input: $input) {
      success
      message
      quoteId
      quoteReference
      cryptoCurrency
      tokenAddress
      amountBaseUnits
      totalBaseUnits
      displayAmount
      network
      chainId
      expiresAt
    }
  }
`;

export const GQL_CREATE_TRANSACTION = /* GraphQL */ `
  mutation CreateTransaction($input: CreateTransactionInput!) {
    createTransaction(input: $input) {
      success
      message
      paymentIdBytes32
      backendSignature
      tokenAddress
      amountBaseUnits
      totalBaseUnits
      chainId
      deadline
      expiresAt
      transaction {
        transactionReference
        transactionStatus
        vendorInfo {
          vendorIdentifier
          suiWalletAddress
        }
      }
    }
  }
`;

export const GQL_TRANSACTION_STATUS = /* GraphQL */ `
  query GetTransactionStatus($transactionReference: String!) {
    getTransactionStatus(transactionReference: $transactionReference) {
      transactionReference
      transactionStatus
      blockchainHash
      blockchainNetwork
      displayAmount
      cryptoCurrency
      payerWalletAddress
      initiatedAt
    }
  }
`;

// Reports the on-chain tx hash back to the backend the instant the wallet
// broadcasts it. This is what lets the backend confirm the payment within
// seconds (via a direct receipt check) instead of waiting for its block
// listener to scan up to REQUIRED_CONFIRMATIONS blocks behind the tip. It
// also flips the transaction to `processing` so the dashboard/widget reflect
// the true state immediately.
export const GQL_SUBMIT_TRANSACTION_HASH = /* GraphQL */ `
  mutation SubmitTransactionHash($input: SubmitTransactionHashInput!) {
    submitTransactionHash(input: $input) {
      transactionReference
      transactionStatus
      blockchainHash
      blockchainNetwork
    }
  }
`;
