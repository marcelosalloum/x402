import { createPublicClient, http, type Chain } from "viem";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";

export type EvmNetwork = "base" | "base-sepolia";

interface NetworkConfig {
  chain: Chain;
  rpcUrl?: string;
  isL2: boolean;
  l1Chain?: Chain;
  l1RpcUrl?: string;
  l2OutputOracleAddress?: `0x${string}`;
  batchInboxAddress?: `0x${string}`;
}

const networkConfigs: Record<EvmNetwork, NetworkConfig> = {
  base: {
    chain: base,
    rpcUrl: "https://mainnet.base.org",
    isL2: true,
    l1Chain: mainnet,
    l1RpcUrl: "https://eth.llamarpc.com",
    l2OutputOracleAddress: "0x56315b90c40730925ec5485cf004d835058518A0",
    batchInboxAddress: "0xff00000000000000000000000000000000008453",
  },
  "base-sepolia": {
    chain: baseSepolia,
    rpcUrl: "https://sepolia.base.org",
    isL2: true,
    l1Chain: sepolia,
    l1RpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    l2OutputOracleAddress: "0x84457ca9D0163FbC4bbfe4Dfbb20ba46e48DF254",
    batchInboxAddress: "0xff00000000000000000000000000000000084532",
  },
};

export interface EvmFinalityEstimate {
  network: EvmNetwork;
  chainId: number;
  softFinalitySeconds: number;
  hardFinalitySeconds: number;
  softFinalityFormatted: string;
  hardFinalityFormatted: string;
  finalityNotes: string;
  isL2: boolean;
  softFinalitySource: string;
  hardFinalitySource: string;
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}

/**
 * Measure the average block time over the last N blocks (Soft Finality / Sequencer Confirmation)
 */
async function measureSoftFinality(
  config: NetworkConfig
): Promise<{ seconds: number; source: string }> {
  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  const latestBlock = await client.getBlockNumber();
  const sampleSize = 10;
  const startBlock = latestBlock - BigInt(sampleSize);

  const [firstBlock, lastBlock] = await Promise.all([
    client.getBlock({ blockNumber: startBlock }),
    client.getBlock({ blockNumber: latestBlock }),
  ]);

  const timeDiff = Number(lastBlock.timestamp - firstBlock.timestamp);
  const blockDiff = Number(latestBlock - startBlock);
  const avgBlockTime = timeDiff / blockDiff;

  return {
    seconds: avgBlockTime,
    source: `Measured from ${sampleSize} recent blocks (${startBlock}-${latestBlock})`,
  };
}

/**
 * Measure time difference between L2 tip and L1 finalized block (Hard Finality)
 */
async function measureHardFinality(
  config: NetworkConfig
): Promise<{ seconds: number; source: string }> {
  if (!config.isL2) {
    return {
      seconds: 0,
      source: "N/A (not an L2)",
    };
  }

  try {
    const client = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    const [latestBlock, finalizedBlock] = await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.getBlock({ blockTag: "finalized" }),
    ]);

    const diff = Number(latestBlock.timestamp - finalizedBlock.timestamp);

    return {
      seconds: diff,
      source: `Measured live from 'finalized' block lag (Block #${finalizedBlock.number} vs #${latestBlock.number})`,
    };
  } catch (error) {
    // Fallback: typical Base finality (2min batch + 13min Ethereum = ~15min)
    const fallbackTime = 900; // 15 minutes
    return {
      seconds: fallbackTime,
      source: `Fallback: ~15m typical (RPC failed to fetch finalized block)`,
    };
  }
}

export async function getEvmFinality(
  network: EvmNetwork = "base-sepolia"
): Promise<EvmFinalityEstimate> {
  const config = networkConfigs[network];
  if (!config) {
    throw new Error(
      `Unsupported network: ${network}. Supported: ${Object.keys(
        networkConfigs
      ).join(", ")}`
    );
  }

  const [soft, hard] = await Promise.all([
    measureSoftFinality(config),
    measureHardFinality(config),
  ]);

  const finalityNotes = config.isL2
    ? `Soft: L2 sequencer confirmation. Hard: L2 data finalized on L1 (reorg-safe).`
    : `Soft: Block confirmation. Hard: Probabilistic finality after N confirmations`;

  return {
    network,
    chainId: config.chain.id,
    softFinalitySeconds: soft.seconds,
    hardFinalitySeconds: hard.seconds,
    softFinalityFormatted: formatSeconds(soft.seconds),
    hardFinalityFormatted: formatSeconds(hard.seconds),
    finalityNotes,
    isL2: config.isL2,
    softFinalitySource: soft.source,
    hardFinalitySource: hard.source,
  };
}

// --- CLI Execution ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("\nUsage: pnpm evm-finality [network]");
    console.log("\nArguments:");
    console.log("  network           EVM network (default: base-sepolia)");
    console.log("\nOptions:");
    console.log("  --list            List all supported networks");
    printSupportedNetworks();
    return;
  }

  if (args.includes("--list")) {
    printSupportedNetworks();
    return;
  }

  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const network = (positionalArgs[0] ?? "base-sepolia") as EvmNetwork;

  if (!networkConfigs[network]) {
    console.error(`❌ Unknown network: ${network}`);
    printSupportedNetworks();
    process.exit(1);
  }

  console.log(`\n⛽ EVM Finality Times (${network})\n${"=".repeat(40)}`);
  console.log("Measuring live network data...\n");

  try {
    const estimate = await getEvmFinality(network);

    console.log(`Network:          ${estimate.network}`);
    console.log(`Chain ID:         ${estimate.chainId}`);
    console.log(`Soft Finality:    ${estimate.softFinalityFormatted}`);
    console.log(`  Source:         ${estimate.softFinalitySource}`);
    console.log(`Hard Finality:    ${estimate.hardFinalityFormatted}`);
    console.log(`  Source:         ${estimate.hardFinalitySource}`);
    console.log(`Notes:            ${estimate.finalityNotes}`);
    console.log();
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function printSupportedNetworks() {
  console.log("\nSupported networks:");
  for (const [name, config] of Object.entries(networkConfigs)) {
    const l2 = config.isL2 ? " [L2]" : "";
    console.log(`  ${name.padEnd(18)} (chainId: ${config.chain.id})${l2}`);
  }
  console.log();
}

import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
