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
      hasNearWallet
      activeStatus
    }
  }
`;

export const GQL_GET_VENDOR_LEGACY = GQL_GET_VENDOR.replace(/\n\s*hasNearWallet/, "");

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
      vendorIdentifier
      vendorWallet
      contractAddress
      registryObjectId
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

export const GQL_CREATE_TRANSACTION_LEGACY = GQL_CREATE_TRANSACTION.replace(/\n\s*contractAddress\n\s*registryObjectId/, "");

export const GQL_VERIFY_PAYMENT = /* GraphQL */ `
  query VerifyPayment(
    $transactionReference: String!
    $expectedAmount: Float!
    $expectedCurrency: String!
    $orderReference: String
  ) {
    verifyPayment(
      transactionReference: $transactionReference
      orderReference: $orderReference
      expectedAmount: $expectedAmount
      expectedCurrency: $expectedCurrency
    ) {
      paid
      reason
      transactionReference
      transactionStatus
      orderReference
      fiatAmount
      fiatCurrency
      cryptoCurrency
      displayAmount
      blockchainNetwork
      blockchainHash
      vendorIdentifier
      initiatedAt
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

export const GQL_PAYMENT_NETWORKS = /* GraphQL */ `
  query PaymentNetworks {
    paymentNetworks {
      key
      name
      environment
      ecosystem
      chainId
      contractAddress
      registryObjectId
      platformFeeBps
      explorerTxUrl
      publicRpcUrl
      nativeSymbol
      networkPassphrase
      logoUrl
      tokens {
        symbol
        displaySymbol
        name
        logoUrl
        address
        decimals
        isNative
      }
    }
  }
`;

export const GQL_VENDOR_CROSS_CHAIN = /* GraphQL */ `
  query VendorCrossChain($vendorIdentifier: String!) {
    getVendor(vendorIdentifier: $vendorIdentifier) {
      crossChainNetworks
    }
  }
`;

const PAYMENT_ROUTE_FIELDS = `
  routeId
  transactionReference
  transactionStatus
  status
  originAsset
  originChain
  depositAddress
  depositMemo
  amountIn
  amountInFormatted
  amountOut
  network
  token
  recipient
  refundAddress
  deadline
  fundableUntil
  timeEstimateSeconds
  originTransactions { hash explorerUrl }
  destinationTransaction { hash explorerUrl }
  refundedAmount
  refundReason
  paidLate
`;

export const GQL_CROSS_CHAIN_OPTIONS = /* GraphQL */ `
  query CrossChainOptions($quoteId: Int!) {
    crossChainOptions(quoteId: $quoteId) {
      originAsset
      name
      chain
      chainName
      decimals
      available
      amountIn
      amountInFormatted
      amountInUsd
      timeEstimateSeconds
      minimumUsd
      needsMemo
      reason
      code
    }
  }
`;

export const GQL_CREATE_CROSS_CHAIN_PAYMENT = /* GraphQL */ `
  mutation CreateCrossChainPayment($input: CreateCrossChainPaymentInput!) {
    createCrossChainPayment(input: $input) {
      success
      message
      code
      resumed
      route { ${PAYMENT_ROUTE_FIELDS} }
    }
  }
`;

export const GQL_PAYMENT_ROUTE = /* GraphQL */ `
  query PaymentRoute($transactionReference: String!) {
    paymentRoute(transactionReference: $transactionReference) { ${PAYMENT_ROUTE_FIELDS} }
  }
`;

export const GQL_SUBMIT_CROSS_CHAIN_DEPOSIT = /* GraphQL */ `
  mutation SubmitCrossChainDeposit($transactionReference: String!, $txHash: String!) {
    submitCrossChainDeposit(transactionReference: $transactionReference, txHash: $txHash)
  }
`;
