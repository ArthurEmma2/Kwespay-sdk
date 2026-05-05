export const GQL_VALIDATE_KEY = `
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

export const GQL_CREATE_QUOTE = `
  mutation CreateQuote($input: CreateQuoteInput!) {
    createQuote(input: $input) {
      success
      message
      quoteId
      quoteReference
      cryptoCurrency
      tokenAddress
      amountBaseUnits
      displayAmount
      network
      chainId
      expiresAt
    }
  }
`;

// deadline is NOT queried — derived from expiresAt (same point in time, Unix int).
// Add `deadline` back here after the backend schema is regenerated with the
// updated BlockchainTransactionResponse type.
export const GQL_CREATE_TRANSACTION = `
  mutation CreateTransaction($input: CreateTransactionInput!) {
    createTransaction(input: $input) {
      success
      message
      paymentIdBytes32
      backendSignature
      tokenAddress
      amountBaseUnits
      chainId
      expiresAt
      transaction {
        transactionReference
        transactionStatus
      }
    }
  }
`;

export const GQL_TRANSACTION_STATUS = `
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
