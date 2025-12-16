import { createPublicClient, http, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";

export type EvmNetwork = "base" | "base-sepolia";

interface NetworkConfig {
  chain: Chain;
  rpcUrl?: string;
  isL2: boolean;
}

const networkConfigs: Record<EvmNetwork, NetworkConfig> = {
  base: {
    chain: base,
    rpcUrl: "https://mainnet.base.org",
    isL2: true,
  },
  "base-sepolia": {
    chain: baseSepolia,
    rpcUrl: "https://sepolia.base.org",
    isL2: true,
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

async function measureHardFinality(
  config: NetworkConfig
): Promise<{ seconds: number; source: string }> {
  if (!config.isL2) {
    return {
      seconds: 0,
      source: "N/A (not an L2)",
    };
  }

  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  const [latestBlock, finalizedBlock] = await Promise.all([
    client.getBlock({ blockTag: "latest" }),
    client.getBlock({ blockTag: "finalized" }),
  ]);

  const diff = Number(latestBlock.timestamp - finalizedBlock.timestamp);

  if (diff < 0) {
    throw new Error(
      `Invalid finalized block lag: finalized block is newer than latest block`
    );
  }

  return {
    seconds: diff,
    source: `Measured live from 'finalized' block lag (Block #${finalizedBlock.number} vs #${latestBlock.number})`,
  };
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
