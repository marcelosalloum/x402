/**
 * Network ranking logic for the Economic Load Balancer Dashboard
 */

import type { NetworkEstimate, NetworkRanking, RankingResult, RankingCriteria } from "./types";
import { formatDuration } from "./utils";
import { CRITERIA_CONFIG, MS_PER_SECOND } from "./constants";

// ============================================================================
// Ranking Functions
// ============================================================================

/**
 * Compares two network estimates based on the specified criteria
 * @param a - First network estimate
 * @param b - Second network estimate
 * @param criteria - Ranking criteria
 * @returns Negative if a < b, positive if a > b, 0 if equal
 */
export function compareNetworks(
  a: NetworkEstimate,
  b: NetworkEstimate,
  criteria: RankingCriteria
): number {
  switch (criteria) {
    case "lowest-cost":
      return parseFloat(a.feeUsdc) - parseFloat(b.feeUsdc);
    case "soft-finality":
      return a.softFinalityMs - b.softFinalityMs;
    case "hard-finality":
      return a.hardFinalityMs - b.hardFinalityMs;
  }
}

/**
 * Generates a human-readable reason for why a network was ranked first
 * @param first - Top-ranked network
 * @param second - Second-ranked network
 * @param criteria - Ranking criteria used
 * @returns Explanation string
 */
export function generateRankingReason(
  first: NetworkRanking,
  second: NetworkRanking,
  criteria: RankingCriteria
): string {
  switch (criteria) {
    case "lowest-cost": {
      const ratio = (
        parseFloat(second.estimate.feeUsdc) / parseFloat(first.estimate.feeUsdc)
      ).toFixed(1);
      return `${first.network} is ${ratio}x cheaper than ${second.network} ($${first.estimate.feeUsdc} vs $${second.estimate.feeUsdc})`;
    }
    case "soft-finality": {
      const ratio = (
        second.estimate.softFinalityMs / first.estimate.softFinalityMs
      ).toFixed(1);
      const firstSeconds = (first.estimate.softFinalityMs / MS_PER_SECOND).toFixed(1);
      const secondSeconds = (second.estimate.softFinalityMs / MS_PER_SECOND).toFixed(1);
      return `${first.network} is ${ratio}x faster (soft) than ${second.network} (${firstSeconds}s vs ${secondSeconds}s)`;
    }
    case "hard-finality": {
      const ratio = (
        second.estimate.hardFinalityMs / first.estimate.hardFinalityMs
      ).toFixed(1);
      return `${first.network} is ${ratio}x faster (hard) than ${second.network} (${formatDuration(first.estimate.hardFinalityMs)} vs ${formatDuration(second.estimate.hardFinalityMs)})`;
    }
  }
}

/**
 * Ranks networks based on the specified criteria
 * @param estimates - Network estimates to rank
 * @param criteria - Ranking criteria
 * @returns Ranking result with sorted networks and explanation
 * @throws Error if fewer than 2 networks are provided
 */
export function rankNetworks(
  estimates: NetworkEstimate[],
  criteria: RankingCriteria
): RankingResult {
  if (estimates.length < 2) {
    throw new Error("Ranking requires at least 2 networks");
  }

  const sorted = [...estimates].sort((a, b) => compareNetworks(a, b, criteria));

  const rankings: NetworkRanking[] = sorted.map((estimate, index) => ({
    network: estimate.network,
    rank: index + 1,
    estimate,
  }));

  const [first, second] = rankings;
  if (!first || !second) {
    throw new Error("Insufficient rankings generated");
  }

  const reason = generateRankingReason(first, second, criteria);

  return {
    criteria,
    rankings,
    reason,
    timestamp: Date.now(),
  };
}

/**
 * Formats criteria for display in UI
 */
export function formatCriteriaForDisplay(criteria: RankingCriteria): string {
  return CRITERIA_CONFIG[criteria].displayName;
}

