/**
 * PaymentRanker - Ranks x402 payment options by cost or finality
 *
 * Consumes PaymentRequirements from x402 protocol and returns the best option
 * based on the specified ranking criteria. Unhealthy networks are automatically skipped.
 */

import { NetworkAnalysis } from "./network-analysis.js";
import type {
  PaymentRequirement,
  RankingCriteria,
  RankingResult,
  NetworkEstimate,
  SupportedNetwork,
  AnalysisConfig,
} from "./types.js";

export interface RankerConfig extends Partial<AnalysisConfig> {
  sponsoredNetworks?: SupportedNetwork[];
  skipUnhealthy?: boolean;
}

export class PaymentRanker {
  private readonly analysis: NetworkAnalysis;
  private readonly sponsoredNetworks: Set<SupportedNetwork>;
  private readonly skipUnhealthy: boolean;

  constructor(config: RankerConfig = {}) {
    this.analysis = new NetworkAnalysis(config);
    this.sponsoredNetworks = new Set(config.sponsoredNetworks ?? []);
    this.skipUnhealthy = config.skipUnhealthy ?? true;
  }

  async rank(
    requirements: PaymentRequirement[],
    criteria: RankingCriteria
  ): Promise<RankingResult> {
    if (requirements.length === 0) {
      throw new Error("At least one payment requirement is required");
    }

    // Filter to supported networks
    const validRequirements = requirements.filter((req) =>
      this.analysis.isNetworkSupported(req.network)
    );

    if (validRequirements.length === 0) {
      throw new Error(
        `No supported networks found. Supported: ${this.analysis
          .getSupportedNetworks()
          .join(", ")}`
      );
    }

    // Get estimates for all networks (will filter unhealthy if enabled)
    const allNetworks = validRequirements.map((req) => req.network);
    const estimates = await this.analysis.getMultipleEstimates(
      allNetworks,
      [...this.sponsoredNetworks],
      { skipUnhealthy: this.skipUnhealthy }
    );

    // Identify unhealthy networks that were skipped
    const unhealthyNetworks = allNetworks.filter((n) => !estimates.has(n));

    // Filter requirements to only include healthy networks
    const healthyRequirements = validRequirements.filter((req) =>
      estimates.has(req.network)
    );

    if (healthyRequirements.length === 0) {
      throw new Error(
        `All networks are unhealthy: ${unhealthyNetworks.join(", ")}`
      );
    }

    // Score and rank options
    const scoredOptions = healthyRequirements.map((req) => {
      const estimate = estimates.get(req.network)!;
      const score = this.calculateScore(estimate, criteria);
      return {
        requirement: req,
        estimate,
        score,
        costUsdc: estimate.cost.feeUsdc,
        finalityMs: estimate.finality.softFinalityMs,
      };
    });

    // Sort by score (lower is better for both criteria)
    scoredOptions.sort((a, b) => a.score - b.score);

    const best = scoredOptions[0];
    const reason = this.generateReason(scoredOptions, criteria, best);

    return {
      best: best.requirement,
      criteria,
      reason,
      estimates,
      rankedOptions: scoredOptions.map(({ requirement, score, costUsdc, finalityMs }) => ({
        requirement,
        score,
        costUsdc,
        finalityMs,
      })),
      unhealthyNetworks: unhealthyNetworks.length > 0 ? unhealthyNetworks : undefined,
    };
  }

  async rankLowestCost(
    requirements: PaymentRequirement[]
  ): Promise<RankingResult> {
    return this.rank(requirements, "lowest-cost");
  }

  async rankFastestFinality(
    requirements: PaymentRequirement[]
  ): Promise<RankingResult> {
    return this.rank(requirements, "fastest-finality");
  }

  async getBest(
    requirements: PaymentRequirement[],
    criteria: RankingCriteria
  ): Promise<PaymentRequirement> {
    const result = await this.rank(requirements, criteria);
    return result.best;
  }

  setSponsored(network: SupportedNetwork, isSponsored: boolean): void {
    if (isSponsored) {
      this.sponsoredNetworks.add(network);
    } else {
      this.sponsoredNetworks.delete(network);
    }
    // Invalidate cache for this network since sponsorship changed
    this.analysis.invalidateCache(network);
  }

  async checkNetworkHealth(network: SupportedNetwork) {
    return this.analysis.checkHealth(network);
  }

  async getHealthyNetworks(networks: SupportedNetwork[]) {
    return this.analysis.getHealthyNetworks(networks);
  }

  isNetworkSupported(network: string): boolean {
    return this.analysis.isNetworkSupported(network);
  }

  getSupportedNetworks(): SupportedNetwork[] {
    return this.analysis.getSupportedNetworks();
  }

  invalidateCache(network?: SupportedNetwork): void {
    this.analysis.invalidateCache(network);
  }

  private calculateScore(
    estimate: NetworkEstimate,
    criteria: RankingCriteria
  ): number {
    switch (criteria) {
      case "lowest-cost":
        // Sponsored = 0 cost
        if (estimate.cost.isSponsored) return 0;
        return parseFloat(estimate.cost.feeUsdc);

      case "fastest-finality":
        // Use soft finality (sequencer confirmation) for speed
        return estimate.finality.softFinalityMs;

      default:
        throw new Error(`Unknown criteria: ${criteria}`);
    }
  }

  private generateReason(
    scoredOptions: Array<{
      requirement: PaymentRequirement;
      estimate: NetworkEstimate;
      score: number;
      costUsdc: string;
      finalityMs: number;
    }>,
    criteria: RankingCriteria,
    best: typeof scoredOptions[0]
  ): string {
    const { network } = best.requirement;

    if (scoredOptions.length === 1) {
      return `Only option: ${network}`;
    }

    const second = scoredOptions[1];

    switch (criteria) {
      case "lowest-cost": {
        if (best.estimate.cost.isSponsored) {
          return `${network} is sponsored (0 USDC fee)`;
        }
        if (second.estimate.cost.isSponsored) {
          return `${network} costs ${best.costUsdc} USDC (${second.requirement.network} is sponsored but was not selected)`;
        }
        const ratio = (second.score / best.score).toFixed(1);
        return `${network} is ${ratio}x cheaper (${best.costUsdc} vs ${second.costUsdc} USDC)`;
      }

      case "fastest-finality": {
        const ratio = (second.finalityMs / best.finalityMs).toFixed(1);
        const bestMs = best.finalityMs;
        const secondMs = second.finalityMs;
        return `${network} is ${ratio}x faster (${this.formatMs(bestMs)} vs ${this.formatMs(secondMs)})`;
      }

      default:
        return `${network} ranked best for ${criteria}`;
    }
  }

  private formatMs(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds.toFixed(0)}s`
      : `${minutes}m`;
  }
}

// Factory function for convenience
export function createPaymentRanker(config?: RankerConfig): PaymentRanker {
  return new PaymentRanker(config);
}
