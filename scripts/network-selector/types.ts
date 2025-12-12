/**
 * Core types for x402 Economic Load Balancer
 */

// Supported network types (extensible for future networks like Solana, Polygon)
export type EvmNetwork = "base" | "base-sepolia";
export type StellarNetwork = "stellar-testnet" | "stellar-mainnet";
export type SupportedNetwork = EvmNetwork | StellarNetwork;

// Network family for polymorphic handling
export type NetworkFamily = "evm" | "stellar" | "svm";

// Network health status
export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface NetworkHealth {
  network: SupportedNetwork;
  status: HealthStatus;
  latencyMs: number;
  lastChecked: number;
  error?: string;
}

// Cost estimation result (unified across all networks)
export interface CostEstimate {
  network: SupportedNetwork;
  networkFamily: NetworkFamily;
  feeNative: string;
  feeUsdc: string;
  nativeSymbol: string;
  nativeUsdPrice: number;
  isSponsored: boolean;
  isSimulated: boolean;
  timestamp: number;
}

// Finality estimation result
export interface FinalityEstimate {
  network: SupportedNetwork;
  softFinalityMs: number;
  hardFinalityMs: number;
  finalityNotes: string;
  timestamp: number;
}

// Combined network estimate (cost + finality + health)
export interface NetworkEstimate {
  cost: CostEstimate;
  finality: FinalityEstimate;
  health?: NetworkHealth;
}

// PaymentRequirement from x402 protocol (simplified for this module)
export interface PaymentRequirement {
  network: SupportedNetwork;
  amount: string;
  asset: string;
  payTo: string;
  maxAmountRequired?: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  outputSchema?: unknown;
  extra?: Record<string, unknown>;
}

// Ranking criteria
export type RankingCriteria = "lowest-cost" | "fastest-finality";

// Ranking result with explanation
export interface RankingResult {
  best: PaymentRequirement;
  criteria: RankingCriteria;
  reason: string;
  estimates: Map<SupportedNetwork, NetworkEstimate>;
  rankedOptions: Array<{
    requirement: PaymentRequirement;
    score: number;
    costUsdc: string;
    finalityMs: number;
  }>;
  unhealthyNetworks?: SupportedNetwork[];
}

// Cache entry with TTL support
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

// Network analysis configuration
export interface AnalysisConfig {
  cacheTtlMs: number;
  enableCaching: boolean;
  healthCheckEnabled: boolean;
  healthCheckTimeoutMs: number;
}

export const DEFAULT_CONFIG: AnalysisConfig = {
  cacheTtlMs: 60_000, // 60 seconds
  enableCaching: true,
  healthCheckEnabled: true,
  healthCheckTimeoutMs: 5_000, // 5 seconds
};
