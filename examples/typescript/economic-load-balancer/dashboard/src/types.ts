/**
 * Type definitions for the Economic Load Balancer Dashboard
 */

import type { PaymentRequirements } from "x402/types";
import type { RankingCriteria } from "./constants";

// ============================================================================
// Network Types
// ============================================================================

export type Network = "base-sepolia" | "stellar-testnet";

export type NetworkRankerCriteriaType =
  | "lowest-cost"
  | "fastest-soft-finality"
  | "fastest-hard-finality";

export type LogEntryType = "info" | "success" | "error" | "cached";

// ============================================================================
// Data Structures
// ============================================================================

export interface NetworkEstimate {
  network: Network;
  feeUsdc: string;
  feeNative: string;
  nativeSymbol: string;
  softFinalityMs: number;
  hardFinalityMs: number;
  isHealthy: boolean;
  latencyMs: number;
}

export interface NetworkRanking {
  network: Network;
  rank: number;
  estimate: NetworkEstimate;
}

export interface RankingResult {
  criteria: RankingCriteria;
  rankings: NetworkRanking[];
  reason: string;
  timestamp: number;
}

export interface LogEntry {
  time: string;
  message: string;
  type: LogEntryType;
}

export interface ApiResponse {
  estimates: Array<{
    network: Network;
    feeUsdc: number;
    feeNative: string;
    nativeSymbol: string;
    softFinalityMs: number;
    hardFinalityMs: number;
    isHealthy: boolean;
    latencyMs: number;
  }>;
  timestamp?: number;
}

export interface ProtectedResource {
  data: unknown;
  timestamp: number;
}

