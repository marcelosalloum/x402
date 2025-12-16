import {
  createPublicClient,
  http,
  formatEther,
  formatGwei,
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

export type EvmNetwork = keyof typeof networkConfigs;

const EIP3009_GAS_ESTIMATE = 85_000n;
const OP_GAS_ORACLE = "0x420000000000000000000000000000000000000F" as Address;

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

const TEST_WALLET = {
  privateKey:
    "0x70cb23ffff10eb6809e609436a713384eac9f177d8c882c580a5ea8d93cae675" as Hex,
  address: "0xc2D686352D971e0c03e7ac20f92C9A2c09a4260D" as Address,
};

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
    const value = 1000000n;
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

    const relayerAccount =
      "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" as Address;
    const gasEstimate = await client.estimateGas({
      to: config.usdcAddress,
      data,
      account: relayerAccount,
    });

    return { gasUsed: gasEstimate, isSimulated: true };
  } catch (error) {
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

  if (network.startsWith("base") || network.startsWith("optimism")) {
    try {
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

  if (network.startsWith("arbitrum")) {
    const calldataBytes = BigInt(sampleCalldata.length / 2 - 1);
    const l1GasPerByte = 16n;
    const estimatedL1GasPrice = 30_000_000_000n;
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

  // Always fetch live price - NO FALLBACKS
  const nativeUsdPrice = await getCryptoPrice(config.nativeSymbol);

  if (isSponsored) {
    return {
      network,
      chainId: config.chain.id,
      nativeSymbol: config.nativeSymbol,
      nativeUsdPrice,
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

  const { gasUsed, isSimulated } = await simulateTransferWithAuthorization(
    client,
    network
  );

  const gasPrice = await client.getGasPrice();
  const estimatedGasUnits = gasUsed;

  const l2ExecutionCostWei = gasPrice * estimatedGasUnits;

  const l1DataCostWei = await getL1DataFee(
    client,
    network,
    gasPrice,
    estimatedGasUnits
  );

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

