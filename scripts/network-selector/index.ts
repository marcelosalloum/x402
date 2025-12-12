/**
 * x402 Economic Load Balancer - Network Selector Module
 *
 * Provides unified cost and finality estimation across EVM and Stellar networks,
 * with intelligent caching, health checking, and payment ranking capabilities.
 */

// Core types
export type {
  SupportedNetwork,
  EvmNetwork,
  StellarNetwork,
  NetworkFamily,
  HealthStatus,
  NetworkHealth,
  CostEstimate,
  FinalityEstimate,
  NetworkEstimate,
  PaymentRequirement,
  RankingCriteria,
  RankingResult,
  CacheEntry,
  AnalysisConfig,
} from "./types.js";

export { DEFAULT_CONFIG } from "./types.js";

// Cache
export { TtlCache } from "./cache.js";

// Network Analysis
export { NetworkAnalysis, getNetworkAnalysis } from "./network-analysis.js";

// Payment Ranker
export { PaymentRanker, createPaymentRanker } from "./payment-ranker.js";
export type { RankerConfig } from "./payment-ranker.js";

// Re-export raw estimator functions for direct use
export { getEvmFeeCost } from "./evm-gas.js";
export type { EvmCostEstimate } from "./evm-gas.js";

export { getStellarFeeCost } from "./stellar-gas.js";
export type { StellarCostEstimate } from "./stellar-gas.js";

export { getEvmFinality } from "./evm-finality.js";
export type { EvmFinalityEstimate } from "./evm-finality.js";

export { getStellarFinality } from "./stellar-finality.js";
export type { StellarFinalityEstimate } from "./stellar-finality.js";
