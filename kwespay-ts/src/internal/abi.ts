export const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

export const PAYMENT_ABI = [
  "function createPayment(bytes32 paymentId, string vendorId, address token, uint256 amount, bytes backendSignature) external payable",
  "function getPayment(bytes32 paymentId) external view returns (address vendor, address customer, uint256 amount, uint256 vendorAmount, uint256 feeAmount, address token, uint256 createdAt)",
] as const;

export const SELECTORS = {
  allowance: "dd62ed3e",
  approve: "095ea7b3",
  createPayment: "8264f2c2",
  getPayment: "9b5aac92",
} as const;
