/**
 * Network Payment Ranker for x402 Economic Load Balancer
 *
 * This module analyzes and ranks different blockchain networks for x402 payments
 * based on cost, finality time, and network health using real-time data.
 */

import {
  NetworkAnalysis,
  getNetworkAnalysis,
  type SupportedNetwork,
} from "../network-analysis/index.js";

export type { SupportedNetwork };

// ============================================================================
// Types
// ============================================================================

export type RankingCriteria =
  | "lowest-cost"
  | "fastest-soft-finality"
  | "fastest-hard-finality";

export interface PaymentOption {
  network: SupportedNetwork;
  amount: string;
  asset: string;
  payTo: string;
  description?: string;
}

export interface NetworkEstimate {
  network: SupportedNetwork;
  feeUsdc: number;
  feeNative: string;
  nativeSymbol: string;
  nativeUsdPrice: number;
  softFinalityMs: number;
  hardFinalityMs: number;
  isHealthy: boolean;
  latencyMs: number;
}

export interface RankingResult {
  best: PaymentOption;
  criteria: RankingCriteria;
  reason: string;
  rankedOptions: Array<{
    option: PaymentOption;
    estimate: NetworkEstimate;
    score: number;
  }>;
  unhealthyNetworks?: SupportedNetwork[];
}

// ============================================================================
// Ranking Logic
// ============================================================================

/**
 * Calculates a score for a network based on the ranking criteria
 * Lower scores are better
 */
function calculateScore(
  estimate: NetworkEstimate,
  criteria: RankingCriteria
): number {
  if (criteria === "lowest-cost") {
    return estimate.feeUsdc;
  }
  if (criteria === "fastest-soft-finality") {
    return estimate.softFinalityMs;
  }
  if (criteria === "fastest-hard-finality") {
    return estimate.hardFinalityMs;
  }
  return estimate.softFinalityMs;
}

/**
 * Generates a human-readable reason for why a network was selected
 */
function generateReason(
  best: { option: PaymentOption; estimate: NetworkEstimate; score: number },
  second:
    | { option: PaymentOption; estimate: NetworkEstimate; score: number }
    | undefined,
  criteria: RankingCriteria
): string {
  if (!second) {
    return `Only healthy option: ${best.option.network}`;
  }

  if (criteria === "lowest-cost") {
    const ratio = (second.estimate.feeUsdc / best.estimate.feeUsdc).toFixed(1);
    return `${
      best.option.network
    } is ${ratio}x cheaper (${best.estimate.feeUsdc.toFixed(
      6
    )} vs ${second.estimate.feeUsdc.toFixed(6)} USDC)`;
  }

  if (criteria === "fastest-soft-finality") {
    const ratio = (
      second.estimate.softFinalityMs / best.estimate.softFinalityMs
    ).toFixed(1);
    const bestTime = (best.estimate.softFinalityMs / 1000).toFixed(1);
    const secondTime = (second.estimate.softFinalityMs / 1000).toFixed(1);
    return `${best.option.network} is ${ratio}x faster (soft finality: ${bestTime}s vs ${secondTime}s)`;
  }

  if (criteria === "fastest-hard-finality") {
    const ratio = (
      second.estimate.hardFinalityMs / best.estimate.hardFinalityMs
    ).toFixed(1);
    const bestTime = (best.estimate.hardFinalityMs / 1000).toFixed(1);
    const secondTime = (second.estimate.hardFinalityMs / 1000).toFixed(1);
    return `${best.option.network} is ${ratio}x faster (hard finality: ${bestTime}s vs ${secondTime}s)`;
  }

  const ratio = (
    second.estimate.softFinalityMs / best.estimate.softFinalityMs
  ).toFixed(1);
  const bestTime = (best.estimate.softFinalityMs / 1000).toFixed(1);
  const secondTime = (second.estimate.softFinalityMs / 1000).toFixed(1);
  return `${best.option.network} is ${ratio}x faster (${bestTime}s vs ${secondTime}s)`;
}

/**
 * Converts NetworkAnalysis NetworkEstimate to our NetworkEstimate format
 */
function convertNetworkEstimate(
  analysis: NetworkAnalysis,
  networkEstimate: Awaited<ReturnType<typeof analysis.getNetworkEstimate>>
): NetworkEstimate {
  const health = networkEstimate.health;
  return {
    network: networkEstimate.cost.network,
    feeUsdc: parseFloat(networkEstimate.cost.feeUsdc),
    feeNative: networkEstimate.cost.feeNative,
    nativeSymbol: networkEstimate.cost.nativeSymbol,
    nativeUsdPrice: networkEstimate.cost.nativeUsdPrice,
    softFinalityMs: networkEstimate.finality.softFinalityMs,
    hardFinalityMs: networkEstimate.finality.hardFinalityMs,
    isHealthy: health ? health.status !== "unhealthy" : true,
    latencyMs: health?.latencyMs ?? 0,
  };
}

/**
 * Ranks payment options based on the specified criteria using real-time network data
 *
 * @param options - Available payment options to rank
 * @param criteria - Ranking criteria ("lowest-cost", "fastest-soft-finality", or "fastest-hard-finality")
 * @returns Ranking result with best option, analysis, and reasoning
 * @throws Error if all networks are unhealthy
 */
export async function rankPaymentOptions(
  options: PaymentOption[],
  criteria: RankingCriteria
): Promise<RankingResult> {
  const analysis = getNetworkAnalysis();

  // Get real-time estimates for all networks in parallel
  const networks = options.map((opt) => opt.network);
  const estimatesMap = await analysis.getMultipleEstimates(networks, [], {
    skipUnhealthy: false,
    includeHealth: true,
  });

  // Separate healthy and unhealthy networks
  const healthyOptions: Array<{
    option: PaymentOption;
    estimate: NetworkEstimate;
  }> = [];
  const unhealthyNetworks: SupportedNetwork[] = [];

  options.forEach((opt) => {
    const networkEstimate = estimatesMap.get(opt.network);
    if (!networkEstimate) {
      unhealthyNetworks.push(opt.network);
      return;
    }

    const estimate = convertNetworkEstimate(analysis, networkEstimate);
    if (estimate.isHealthy) {
      healthyOptions.push({ option: opt, estimate });
    } else {
      unhealthyNetworks.push(opt.network);
    }
  });

  if (healthyOptions.length === 0) {
    throw new Error(
      `All networks are unhealthy: ${unhealthyNetworks.join(", ")}`
    );
  }

  // Calculate scores and sort by best (lowest) score
  const scored = healthyOptions
    .map(({ option, estimate }) => ({
      option,
      estimate,
      score: calculateScore(estimate, criteria),
    }))
    .sort((a, b) => a.score - b.score);

  const best = scored[0];
  const second = scored[1];
  const reason = generateReason(best, second, criteria);

  return {
    best: best.option,
    criteria,
    reason,
    rankedOptions: scored,
    unhealthyNetworks:
      unhealthyNetworks.length > 0 ? unhealthyNetworks : undefined,
  };
}
