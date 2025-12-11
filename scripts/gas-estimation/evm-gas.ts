#!/usr/bin/env npx tsx
import {
  createPublicClient,
  http,
  formatGwei,
  formatEther,
  encodeFunctionData,
  keccak256,
  toHex,
  parseSignature,
  serializeTransaction,
  type PublicClient,
  type Chain,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, signTypedData } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { getCryptoPrice } from "./utils.js";

interface NetworkConfig {
  chain: Chain;
  rpcUrl?: string;
  nativeSymbol: string;
  nativeUsdPrice: number;
  usdcAddress?: Address;
  isL2: boolean;
}

const networkConfigs = {
  base: {
    chain: base,
    rpcUrl: "https://mainnet.base.org",
    nativeSymbol: "ETH",
    nativeUsdPrice: 3230,
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    isL2: true,
  },
  "base-sepolia": {
    chain: baseSepolia,
    rpcUrl: "https://sepolia.base.org",
    nativeSymbol: "ETH",
    nativeUsdPrice: 3230,
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    isL2: true,
  },
} satisfies Record<string, NetworkConfig>;

type EvmNetwork = keyof typeof networkConfigs;

// Fallback gas limit for EIP-3009 transferWithAuthorization (~85k gas)
const EIP3009_GAS_ESTIMATE = 85_000n;

// OP Stack GasPriceOracle contract (Base, Optimism)
const OP_GAS_ORACLE = "0x420000000000000000000000000000000000000F" as Address;

// EIP-3009 transferWithAuthorization ABI
const TRANSFER_WITH_AUTH_ABI = [
  {
    name: "transferWithAuthorization",
    type: "function",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

// GasPriceOracle ABI for L1 fee estimation
const GAS_ORACLE_ABI = [
  {
    name: "getL1Fee",
    type: "function",
    inputs: [{ name: "_data", type: "bytes" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export interface EvmCostEstimate {
  network: EvmNetwork;
  chainId: number;
  nativeSymbol: string;
  nativeUsdPrice: number;
  gasPriceGwei: string;
  gasPriceWei: bigint;
  estimatedGasUnits: bigint;
  l2ExecutionCostWei: bigint;
  l1DataCostWei: bigint;
  totalCostWei: bigint;
  estimatedCostNative: string;
  estimatedCostUsdc: string;
  isSponsored: boolean;
  isL2: boolean;
  isSimulated: boolean;
}

// Test wallet for simulation (funded with USDC on Base Sepolia)
const TEST_WALLET = {
  privateKey:
    "0x70cb23ffff10eb6809e609436a713384eac9f177d8c882c580a5ea8d93cae675" as Hex,
  address: "0xc2D686352D971e0c03e7ac20f92C9A2c09a4260D" as Address,
};

// USDC domain names vary by network
const USDC_DOMAIN_NAMES: Partial<Record<EvmNetwork, string>> = {
  "base-sepolia": "USDC",
  base: "USD Coin",
};

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

async function simulateTransferWithAuthorization(
  client: PublicClient<any, any>,
  network: EvmNetwork
): Promise<{ gasUsed: bigint; isSimulated: boolean }> {
  const config = networkConfigs[network];
  if (!config.usdcAddress) {
    return { gasUsed: EIP3009_GAS_ESTIMATE, isSimulated: false };
  }

  const domainName = USDC_DOMAIN_NAMES[network];
  if (!domainName) {
    return { gasUsed: EIP3009_GAS_ESTIMATE, isSimulated: false };
  }

  try {
    const account = privateKeyToAccount(TEST_WALLET.privateKey);

    // Check if wallet has USDC balance
    const balance = await client.readContract({
      address: config.usdcAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });

    if (balance === 0n) {
      return { gasUsed: EIP3009_GAS_ESTIMATE, isSimulated: false };
    }

    const to = "0x0000000000000000000000000000000000000001" as Address;
    const value = 1000000n; // 1 USDC (6 decimals)
    const validAfter = 0n;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const nonce = keccak256(toHex(Date.now()));

    const signature = await signTypedData({
      privateKey: TEST_WALLET.privateKey,
      domain: {
        name: domainName,
        version: "2",
        chainId: BigInt(config.chain.id),
        verifyingContract: config.usdcAddress,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: account.address,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
      },
    });

    const { r, s, v } = parseSignature(signature);

    const data = encodeFunctionData({
      abi: TRANSFER_WITH_AUTH_ABI,
      functionName: "transferWithAuthorization",
      args: [
        account.address,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
        Number(v),
        r,
        s,
      ],
    });

    // Estimate gas for the relayer (who pays the gas, not the signer)
    // Use a proper account format for estimation
    const relayerAccount =
      "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" as Address;
    const gasEstimate = await client.estimateGas({
      to: config.usdcAddress,
      data,
      account: relayerAccount,
    });

    return { gasUsed: gasEstimate, isSimulated: true };
  } catch (error) {
    // Only log if we expected it to work (Base/Base Sepolia have configs)
    if (network.includes("base")) {
      console.warn(
        `Simulation warning (${network}):`,
        error instanceof Error ? error.message : String(error)
      );
    }
    return { gasUsed: EIP3009_GAS_ESTIMATE, isSimulated: false };
  }
}

async function getL1DataFee(
  client: PublicClient<any, any>,
  network: EvmNetwork,
  gasPriceWei: bigint,
  gasLimit: bigint
): Promise<bigint> {
  const config = networkConfigs[network];
  if (!config.isL2) return 0n;

  // Build sample EIP-3009 calldata for L1 fee estimation
  const sampleCalldata = encodeFunctionData({
    abi: TRANSFER_WITH_AUTH_ABI,
    functionName: "transferWithAuthorization",
    args: [
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
      1000000n,
      0n,
      BigInt(Math.floor(Date.now() / 1000) + 3600),
      "0x1234567890123456789012345678901234567890123456789012345678901234",
      28,
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    ],
  });

  // OP Stack chains (Base, Optimism) use GasPriceOracle
  if (network.startsWith("base") || network.startsWith("optimism")) {
    try {
      // GasPriceOracle.getL1Fee expects the *unsigned, fully RLP-encoded transaction bytes*,
      // not just calldata. Passing calldata can revert and/or undercount.
      const unsignedSerializedTx = serializeTransaction({
        chainId: config.chain.id,
        nonce: 0,
        gasPrice: gasPriceWei,
        gas: gasLimit,
        to: (config.usdcAddress ??
          "0x0000000000000000000000000000000000000000") as Address,
        value: 0n,
        data: sampleCalldata,
      });

      const l1Fee = await client.readContract({
        address: OP_GAS_ORACLE,
        abi: GAS_ORACLE_ABI,
        functionName: "getL1Fee",
        args: [unsignedSerializedTx],
      });
      return l1Fee;
    } catch {
      return 0n;
    }
  }

  // Arbitrum uses a different mechanism - estimate based on calldata size
  if (network.startsWith("arbitrum")) {
    const calldataBytes = BigInt(sampleCalldata.length / 2 - 1);
    const l1GasPerByte = 16n;
    const estimatedL1GasPrice = 30_000_000_000n; // 30 Gwei estimate for L1
    return calldataBytes * l1GasPerByte * estimatedL1GasPrice;
  }

  return 0n;
}

export async function getEvmFeeCost(
  network: EvmNetwork = "base-sepolia",
  isSponsored: boolean = false
): Promise<EvmCostEstimate> {
  const config = networkConfigs[network];
  if (!config) {
    throw new Error(
      `Unsupported network: ${network}. Supported: ${Object.keys(
        networkConfigs
      ).join(", ")}`
    );
  }

  if (isSponsored) {
    return {
      network,
      chainId: config.chain.id,
      nativeSymbol: config.nativeSymbol,
      nativeUsdPrice: config.nativeUsdPrice,
      gasPriceGwei: "0",
      gasPriceWei: 0n,
      estimatedGasUnits: 0n,
      l2ExecutionCostWei: 0n,
      l1DataCostWei: 0n,
      totalCostWei: 0n,
      estimatedCostNative: "0",
      estimatedCostUsdc: "0.000000",
      isSponsored: true,
      isL2: config.isL2,
      isSimulated: false,
    };
  }

  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl ?? config.chain.rpcUrls.default.http[0]),
  });

  // Fetch live price
  const livePrice = await getCryptoPrice(config.nativeSymbol);
  const nativeUsdPrice = livePrice > 0 ? livePrice : config.nativeUsdPrice;

  // Try to simulate actual transferWithAuthorization
  const { gasUsed, isSimulated } = await simulateTransferWithAuthorization(
    client,
    network
  );

  const gasPrice = await client.getGasPrice();
  const estimatedGasUnits = gasUsed;

  // L2 execution cost
  const l2ExecutionCostWei = gasPrice * estimatedGasUnits;

  // L1 data cost (only for L2s)
  const l1DataCostWei = await getL1DataFee(
    client,
    network,
    gasPrice,
    estimatedGasUnits
  );

  // Total cost
  const totalCostWei = l2ExecutionCostWei + l1DataCostWei;
  const estimatedCostNative = formatEther(totalCostWei);
  const estimatedCostUsdc = Number(estimatedCostNative) * nativeUsdPrice;

  return {
    network,
    chainId: config.chain.id,
    nativeSymbol: config.nativeSymbol,
    nativeUsdPrice,
    gasPriceGwei: formatGwei(gasPrice),
    gasPriceWei: gasPrice,
    estimatedGasUnits,
    l2ExecutionCostWei,
    l1DataCostWei,
    totalCostWei,
    estimatedCostNative,
    estimatedCostUsdc: estimatedCostUsdc.toFixed(6),
    isSponsored: false,
    isL2: config.isL2,
    isSimulated,
  };
}

function printSupportedNetworks() {
  console.log("\nSupported networks:");
  for (const [name, config] of Object.entries(networkConfigs)) {
    const usdc = config.usdcAddress ? "✓ USDC" : "  (no USDC)";
    const l2 = config.isL2 ? " [L2]" : "";
    console.log(
      `  ${name.padEnd(18)} (chainId: ${config.chain.id}) ${usdc}${l2}`
    );
  }
  console.log();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("\nUsage: pnpm evm [network] [options]");
    console.log("\nArguments:");
    console.log("  network           EVM network (default: base-sepolia)");
    console.log("\nOptions:");
    console.log("  --sponsored       Mark as sponsored (cost = 0)");
    console.log("  --list            List all supported networks");
    printSupportedNetworks();
    return;
  }

  if (args.includes("--list")) {
    printSupportedNetworks();
    return;
  }

  const isSponsored = args.includes("--sponsored");
  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const network = (positionalArgs[0] ?? "base-sepolia") as EvmNetwork;

  if (!networkConfigs[network]) {
    console.error(`❌ Unknown network: ${network}`);
    printSupportedNetworks();
    process.exit(1);
  }

  console.log(`\n⛽ EVM Gas Estimation (${network})\n${"=".repeat(40)}`);

  if (isSponsored) {
    console.log("💰 Transaction is SPONSORED by facilitator\n");
  }

  try {
    const estimate = await getEvmFeeCost(network, isSponsored);

    console.log(`Network:        ${estimate.network}`);
    console.log(`Chain ID:       ${estimate.chainId}`);
    console.log(`Gas Price:      ${estimate.gasPriceGwei} Gwei`);
    console.log(`Gas Limit:      ${estimate.estimatedGasUnits} units`);

    if (estimate.isL2) {
      const l2CostNative = formatEther(estimate.l2ExecutionCostWei);
      const l1CostNative = formatEther(estimate.l1DataCostWei);
      console.log(
        `L2 Execution:   ${l2CostNative} ${estimate.nativeSymbol} (${estimate.l2ExecutionCostWei} wei)`
      );
      console.log(
        `L1 Data Fee:    ${l1CostNative} ${estimate.nativeSymbol} (${estimate.l1DataCostWei} wei)`
      );
    }

    console.log(
      `Total Cost:     ${estimate.estimatedCostNative} ${estimate.nativeSymbol} (${estimate.totalCostWei} wei)`
    );
    console.log(`Total Cost:     ${estimate.estimatedCostUsdc} USDC`);
    console.log(
      `Price Rate:     1 ${
        estimate.nativeSymbol
      } = $${estimate.nativeUsdPrice.toFixed(2)} USD`
    );
    console.log(`Sponsored:      ${estimate.isSponsored ? "Yes ✅" : "No"}`);
    console.log(
      `Simulated:      ${
        estimate.isSimulated
          ? "Yes (actual EIP-3009 transfer)"
          : "No (fallback 85k gas)"
      }`
    );
    console.log(`Method:         EIP-3009 transferWithAuthorization`);
    console.log();
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Only run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
