/**
 * Application-wide constants for the Economic Load Balancer Dashboard
 */

// ============================================================================
// Network Configuration
// ============================================================================

export const SUPPORTED_NETWORKS = ["base-sepolia", "stellar-testnet"] as const;
export type SupportedNetwork = (typeof SUPPORTED_NETWORKS)[number];

// USDC decimal places for different networks
export const USDC_DECIMALS = {
  EVM: 1_000_000, // 6 decimals
  STELLAR: 10_000_000, // 7 decimals
} as const;

// ============================================================================
// API Configuration
// ============================================================================

export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "http://localhost:4021";
export const ENDPOINT_PATH = "/premium/agent-insight";

// ============================================================================
// Timing Constants
// ============================================================================

export const RANKING_CACHE_TTL_MS = 60_000; // 60 seconds
export const RELATIVE_TIME_UPDATE_INTERVAL_MS = 1_000; // 1 second
export const MIN_ANALYSIS_DELAY_MS = 300; // UX feedback delay
export const MS_PER_SECOND = 1_000;
export const SECONDS_PER_MINUTE = 60;

// ============================================================================
// UI Constants
// ============================================================================

export const DEFAULT_MAX_FEE_USDC = 0.001;
export const MAX_LOG_ENTRIES = 20;

// ============================================================================
// Ranking Criteria Configuration
// ============================================================================

export const CRITERIA_CONFIG = {
  "lowest-cost": {
    label: "Cost",
    displayName: "lowest cost",
    emoji: "💰",
    networkRankerCriteria: "lowest-cost" as const,
  },
  "soft-finality": {
    label: "Soft Finality",
    displayName: "soft finality",
    emoji: "⚡",
    networkRankerCriteria: "fastest-soft-finality" as const,
  },
  "hard-finality": {
    label: "Hard Finality",
    displayName: "hard finality",
    emoji: "🔒",
    networkRankerCriteria: "fastest-hard-finality" as const,
  },
} as const;

export type RankingCriteria = keyof typeof CRITERIA_CONFIG;

// ============================================================================
// Explorer URLs
// ============================================================================

export const EXPLORER_URLS = {
  "base-sepolia": (address: string) =>
    `https://sepolia.basescan.org/address/${address}`,
  "stellar-testnet": (address: string) =>
    `https://stellar.expert/explorer/testnet/account/${address}`,
} as const;

export const EXPLORER_NAMES = {
  "base-sepolia": "BaseScan",
  "stellar-testnet": "Stellar Expert",
} as const;

