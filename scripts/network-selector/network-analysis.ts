/**
 * NetworkAnalysis - Unified cost and finality estimation across networks
 *
 * Supports EVM (Base, Base Sepolia) and Stellar networks with built-in caching.
 * Includes network health checking to skip unhealthy networks.
 * Designed for extensibility to add Solana, Polygon, etc.
 */

import { TtlCache } from "./cache.js";
import {
  getEvmFeeCost,
  type EvmCostEstimate as RawEvmCostEstimate,
} from "./evm-gas.js";
import {
  getEvmFinality,
  type EvmFinalityEstimate as RawEvmFinalityEstimate,
} from "./evm-finality.js";
import {
  getStellarFeeCost,
  type StellarCostEstimate as RawStellarCostEstimate,
} from "./stellar-gas.js";
import {
  getStellarFinality,
  type StellarFinalityEstimate as RawStellarFinalityEstimate,
} from "./stellar-finality.js";
import type {
  CostEstimate,
  FinalityEstimate,
  NetworkEstimate,
  NetworkHealth,
  HealthStatus,
  SupportedNetwork,
  EvmNetwork,
  StellarNetwork,
  AnalysisConfig,
  DEFAULT_CONFIG,
} from "./types.js";

const EVM_NETWORKS: readonly EvmNetwork[] = ["base", "base-sepolia"] as const;
const STELLAR_NETWORKS: readonly StellarNetwork[] = [
  "stellar-testnet",
  "stellar-mainnet",
] as const;

const EVM_RPC_URLS: Record<EvmNetwork, string> = {
  base: "https://mainnet.base.org",
  "base-sepolia": "https://sepolia.base.org",
};

const STELLAR_RPC_URLS: Record<StellarNetwork, string> = {
  "stellar-testnet": "https://soroban-testnet.stellar.org",
  "stellar-mainnet": "https://mainnet.sorobanrpc.com",
};

function isEvmNetwork(network: string): network is EvmNetwork {
  return EVM_NETWORKS.includes(network as EvmNetwork);
}

function isStellarNetwork(network: string): network is StellarNetwork {
  return STELLAR_NETWORKS.includes(network as StellarNetwork);
}

export class NetworkAnalysis {
  private readonly costCache: TtlCache<CostEstimate>;
  private readonly finalityCache: TtlCache<FinalityEstimate>;
  private readonly healthCache: TtlCache<NetworkHealth>;
  private readonly config: AnalysisConfig;

  constructor(config: Partial<AnalysisConfig> = {}) {
    this.config = {
      cacheTtlMs: config.cacheTtlMs ?? 60_000,
      enableCaching: config.enableCaching ?? true,
      healthCheckEnabled: config.healthCheckEnabled ?? true,
      healthCheckTimeoutMs: config.healthCheckTimeoutMs ?? 5_000,
    };
    this.costCache = new TtlCache<CostEstimate>(this.config.cacheTtlMs);
    this.finalityCache = new TtlCache<FinalityEstimate>(this.config.cacheTtlMs);
    this.healthCache = new TtlCache<NetworkHealth>(this.config.cacheTtlMs);
  }

  private getCacheKey(
    network: SupportedNetwork,
    type: "cost" | "finality" | "health",
    isSponsored?: boolean
  ): string {
    return `${network}:${type}${isSponsored ? ":sponsored" : ""}`;
  }

  async checkHealth(network: SupportedNetwork): Promise<NetworkHealth> {
    const cacheKey = this.getCacheKey(network, "health");

    if (this.config.enableCaching) {
      const cached = this.healthCache.get(cacheKey);
      if (cached) return cached;
    }

    const startTime = Date.now();
    let status: HealthStatus = "unknown";
    let error: string | undefined;

    try {
      if (isEvmNetwork(network)) {
        await this.checkEvmHealth(network);
      } else if (isStellarNetwork(network)) {
        await this.checkStellarHealth(network);
      }

      const latencyMs = Date.now() - startTime;
      status = latencyMs < 2000 ? "healthy" : "degraded";
    } catch (err) {
      status = "unhealthy";
      error = err instanceof Error ? err.message : String(err);
    }

    const health: NetworkHealth = {
      network,
      status,
      latencyMs: Date.now() - startTime,
      lastChecked: Date.now(),
      error,
    };

    if (this.config.enableCaching) {
      this.healthCache.set(cacheKey, health);
    }

    return health;
  }

  private async checkEvmHealth(network: EvmNetwork): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.healthCheckTimeoutMs
    );

    try {
      const response = await fetch(EVM_RPC_URLS[network], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: [],
          id: 1,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = await response.json();
      if (json.error) {
        throw new Error(json.error.message);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async checkStellarHealth(network: StellarNetwork): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.healthCheckTimeoutMs
    );

    try {
      const response = await fetch(STELLAR_RPC_URLS[network], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "getHealth",
          id: 1,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = await response.json();
      if (json.error) {
        throw new Error(json.error.message);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async getHealthyNetworks(
    networks: SupportedNetwork[]
  ): Promise<SupportedNetwork[]> {
    if (!this.config.healthCheckEnabled) {
      return networks;
    }

    const healthChecks = await Promise.all(
      networks.map((n) => this.checkHealth(n))
    );

    return networks.filter((_, i) => healthChecks[i].status !== "unhealthy");
  }

  async estimateCost(
    network: SupportedNetwork,
    isSponsored: boolean = false
  ): Promise<CostEstimate> {
    const cacheKey = this.getCacheKey(network, "cost", isSponsored);

    if (this.config.enableCaching) {
      const cached = this.costCache.get(cacheKey);
      if (cached) return cached;
    }

    let estimate: CostEstimate;

    if (isEvmNetwork(network)) {
      estimate = await this.estimateEvmCost(network, isSponsored);
    } else if (isStellarNetwork(network)) {
      estimate = await this.estimateStellarCost(network, isSponsored);
    } else {
      throw new Error(`Unsupported network: ${network}`);
    }

    if (this.config.enableCaching) {
      this.costCache.set(cacheKey, estimate);
    }

    return estimate;
  }

  async estimateFinality(network: SupportedNetwork): Promise<FinalityEstimate> {
    const cacheKey = this.getCacheKey(network, "finality");

    if (this.config.enableCaching) {
      const cached = this.finalityCache.get(cacheKey);
      if (cached) return cached;
    }

    let estimate: FinalityEstimate;

    if (isEvmNetwork(network)) {
      estimate = await this.estimateEvmFinality(network);
    } else if (isStellarNetwork(network)) {
      estimate = await this.estimateStellarFinality(network);
    } else {
      throw new Error(`Unsupported network: ${network}`);
    }

    if (this.config.enableCaching) {
      this.finalityCache.set(cacheKey, estimate);
    }

    return estimate;
  }

  async getNetworkEstimate(
    network: SupportedNetwork,
    isSponsored: boolean = false,
    includeHealth: boolean = false
  ): Promise<NetworkEstimate> {
    const [cost, finality, health] = await Promise.all([
      this.estimateCost(network, isSponsored),
      this.estimateFinality(network),
      includeHealth && this.config.healthCheckEnabled
        ? this.checkHealth(network)
        : Promise.resolve(undefined),
    ]);

    return { cost, finality, health };
  }

  async getMultipleEstimates(
    networks: SupportedNetwork[],
    sponsoredNetworks: SupportedNetwork[] = [],
    options: { skipUnhealthy?: boolean; includeHealth?: boolean } = {}
  ): Promise<Map<SupportedNetwork, NetworkEstimate>> {
    const { skipUnhealthy = true, includeHealth = false } = options;

    let networksToEstimate = networks;

    // Filter unhealthy networks if enabled
    if (skipUnhealthy && this.config.healthCheckEnabled) {
      networksToEstimate = await this.getHealthyNetworks(networks);
    }

    const sponsoredSet = new Set(sponsoredNetworks);
    const estimates = await Promise.all(
      networksToEstimate.map((network) =>
        this.getNetworkEstimate(network, sponsoredSet.has(network), includeHealth)
      )
    );

    const result = new Map<SupportedNetwork, NetworkEstimate>();
    networksToEstimate.forEach((network, index) => {
      result.set(network, estimates[index]);
    });

    return result;
  }

  invalidateCache(network?: SupportedNetwork): void {
    if (network) {
      this.costCache.invalidate(this.getCacheKey(network, "cost"));
      this.costCache.invalidate(this.getCacheKey(network, "cost", true));
      this.finalityCache.invalidate(this.getCacheKey(network, "finality"));
      this.healthCache.invalidate(this.getCacheKey(network, "health"));
    } else {
      this.costCache.invalidateAll();
      this.finalityCache.invalidateAll();
      this.healthCache.invalidateAll();
    }
  }

  getCacheStats(): {
    costCacheSize: number;
    finalityCacheSize: number;
    healthCacheSize: number;
    cachedNetworks: string[];
  } {
    return {
      costCacheSize: this.costCache.size(),
      finalityCacheSize: this.finalityCache.size(),
      healthCacheSize: this.healthCache.size(),
      cachedNetworks: [
        ...new Set([
          ...this.costCache.keys(),
          ...this.finalityCache.keys(),
          ...this.healthCache.keys(),
        ]),
      ],
    };
  }

  getSupportedNetworks(): SupportedNetwork[] {
    return [...EVM_NETWORKS, ...STELLAR_NETWORKS];
  }

  isNetworkSupported(network: string): network is SupportedNetwork {
    return isEvmNetwork(network) || isStellarNetwork(network);
  }

  private async estimateEvmCost(
    network: EvmNetwork,
    isSponsored: boolean
  ): Promise<CostEstimate> {
    const raw: RawEvmCostEstimate = await getEvmFeeCost(network, isSponsored);

    return {
      network,
      networkFamily: "evm",
      feeNative: raw.estimatedCostNative,
      feeUsdc: raw.estimatedCostUsdc,
      nativeSymbol: raw.nativeSymbol,
      nativeUsdPrice: raw.nativeUsdPrice,
      isSponsored: raw.isSponsored,
      isSimulated: raw.isSimulated,
      timestamp: Date.now(),
    };
  }

  private async estimateStellarCost(
    network: StellarNetwork,
    isSponsored: boolean
  ): Promise<CostEstimate> {
    const raw: RawStellarCostEstimate = await getStellarFeeCost(
      network,
      isSponsored
    );

    return {
      network,
      networkFamily: "stellar",
      feeNative: raw.simulatedFeeXlm,
      feeUsdc: raw.simulatedFeeUsdc,
      nativeSymbol: "XLM",
      nativeUsdPrice: raw.xlmUsdPrice,
      isSponsored: raw.isSponsored,
      isSimulated: raw.isSimulated,
      timestamp: Date.now(),
    };
  }

  private async estimateEvmFinality(
    network: EvmNetwork
  ): Promise<FinalityEstimate> {
    const raw: RawEvmFinalityEstimate = await getEvmFinality(network);

    return {
      network,
      softFinalityMs: raw.softFinalitySeconds * 1000,
      hardFinalityMs: raw.hardFinalitySeconds * 1000,
      finalityNotes: raw.finalityNotes,
      timestamp: Date.now(),
    };
  }

  private async estimateStellarFinality(
    network: StellarNetwork
  ): Promise<FinalityEstimate> {
    const raw: RawStellarFinalityEstimate = await getStellarFinality(network);

    return {
      network,
      softFinalityMs: raw.softFinalitySeconds * 1000,
      hardFinalityMs: raw.hardFinalitySeconds * 1000,
      finalityNotes: raw.finalityNotes,
      timestamp: Date.now(),
    };
  }
}

// Singleton instance for convenience
let defaultAnalysis: NetworkAnalysis | null = null;

export function getNetworkAnalysis(
  config?: Partial<AnalysisConfig>
): NetworkAnalysis {
  if (!defaultAnalysis || config) {
    defaultAnalysis = new NetworkAnalysis(config);
  }
  return defaultAnalysis;
}
