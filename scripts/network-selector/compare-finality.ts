#!/usr/bin/env npx tsx
/**
 * Compare finality times across multiple networks
 * Supports any number of networks in any order
 */

import { NetworkAnalysis } from "./network-analysis.js";
import type { SupportedNetwork, FinalityEstimate, NetworkHealth } from "./types.js";

const NETWORK_ALIASES: Record<string, SupportedNetwork> = {
  base: "base",
  "base-sepolia": "base-sepolia",
  stellar: "stellar-testnet",
  testnet: "stellar-testnet",
  "stellar-testnet": "stellar-testnet",
  mainnet: "stellar-mainnet",
  "stellar-mainnet": "stellar-mainnet",
};

type FinalityType = "soft" | "hard";

interface NetworkFinalityResult {
  network: SupportedNetwork;
  finality: FinalityEstimate;
  health?: NetworkHealth;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds.toFixed(0)}s`
    : `${minutes}m`;
}

function parseNetworks(args: string[]): SupportedNetwork[] {
  const positionalArgs = args.filter((a) => !a.startsWith("--"));

  if (positionalArgs.length === 0) {
    return ["base-sepolia", "stellar-testnet"];
  }

  const networks: SupportedNetwork[] = [];
  for (const arg of positionalArgs) {
    const network = NETWORK_ALIASES[arg];
    if (!network) {
      console.error(`❌ Unknown network: ${arg}`);
      console.error(`   Valid networks: ${Object.keys(NETWORK_ALIASES).join(", ")}`);
      process.exit(1);
    }
    if (!networks.includes(network)) {
      networks.push(network);
    }
  }

  return networks;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("\nUsage: pnpm compare:finality [networks...] [options]");
    console.log("\nArguments:");
    console.log("  networks          One or more networks to compare (order doesn't matter)");
    console.log("                    Default: base-sepolia stellar-testnet");
    console.log("\nOptions:");
    console.log("  --type=<soft|hard>     Finality type to compare (default: soft)");
    console.log("  --skip-unhealthy       Skip unhealthy networks (default: true)");
    console.log("  --no-skip-unhealthy    Include unhealthy networks");
    console.log("  --list                 List all supported networks");
    console.log("\nExamples:");
    console.log("  pnpm compare:finality                        # base-sepolia vs stellar-testnet (soft)");
    console.log("  pnpm compare:finality base stellar-mainnet   # base vs stellar-mainnet");
    console.log("  pnpm compare:finality --type=hard            # hard finality comparison");
    console.log("  pnpm compare:finality stellar base base-sepolia  # 3-way comparison");
    console.log();
    return;
  }

  if (args.includes("--list")) {
    console.log("\nSupported networks:");
    console.log("  EVM:");
    console.log("    base           (Base mainnet)");
    console.log("    base-sepolia   (Base Sepolia testnet)");
    console.log("  Stellar:");
    console.log("    stellar-testnet / stellar / testnet");
    console.log("    stellar-mainnet / mainnet");
    console.log();
    return;
  }

  const typeArg = args.find((a) => a.startsWith("--type="))?.split("=")[1];
  const finalityType = (typeArg ?? "soft") as FinalityType;

  if (finalityType !== "soft" && finalityType !== "hard") {
    console.error(`❌ Invalid finality type: ${finalityType}`);
    console.error("   Must be 'soft' or 'hard'");
    process.exit(1);
  }

  const networks = parseNetworks(args);
  const skipUnhealthy = !args.includes("--no-skip-unhealthy");

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     x402 Economic Load Balancer - Finality Comparison        ║
║                       (${finalityType.toUpperCase()} Finality)${" ".repeat(27 - finalityType.length)}║
╚══════════════════════════════════════════════════════════════╝
`);

  const analysis = new NetworkAnalysis({
    healthCheckEnabled: skipUnhealthy,
  });

  try {
    const results: NetworkFinalityResult[] = [];
    const unhealthyNetworks: SupportedNetwork[] = [];

    for (const network of networks) {
      if (skipUnhealthy) {
        const health = await analysis.checkHealth(network);
        if (health.status === "unhealthy") {
          unhealthyNetworks.push(network);
          console.log(`⚠️  ${network} is unhealthy (${health.error}) - skipping\n`);
          continue;
        }
      }

      const finality = await analysis.estimateFinality(network);
      results.push({ network, finality });
    }

    if (results.length === 0) {
      console.error("❌ All networks are unhealthy");
      process.exit(1);
    }

    // Sort by finality time (fastest first)
    results.sort((a, b) => {
      const aTime = finalityType === "soft"
        ? a.finality.softFinalityMs
        : a.finality.hardFinalityMs;
      const bTime = finalityType === "soft"
        ? b.finality.softFinalityMs
        : b.finality.hardFinalityMs;
      return aTime - bTime;
    });

    // Display each network
    for (const result of results) {
      const { network, finality } = result;
      const isEvm = network.startsWith("base");
      const icon = isEvm ? "⛽" : "⭐";
      const familyLabel = isEvm ? "EVM" : "Stellar";

      console.log(`${icon} ${network} (${familyLabel})`);
      console.log("─".repeat(40));
      console.log(`   Soft Finality:   ${formatMs(finality.softFinalityMs)}`);
      console.log(`   Hard Finality:   ${formatMs(finality.hardFinalityMs)}`);
      console.log(`   Notes:           ${finality.finalityNotes}`);
      console.log();
    }

    // Show recommendation
    if (results.length > 1) {
      const best = results[0];
      const second = results[1];

      const bestTime = finalityType === "soft"
        ? best.finality.softFinalityMs
        : best.finality.hardFinalityMs;
      const secondTime = finalityType === "soft"
        ? second.finality.softFinalityMs
        : second.finality.hardFinalityMs;

      const isEvm = best.network.startsWith("base");
      const icon = isEvm ? "⛽" : "⭐";

      console.log("🏆 Recommendation");
      console.log("─".repeat(40));
      console.log(`   Best Option:     ${icon} ${best.network}`);

      const ratio = (secondTime / bestTime).toFixed(1);
      console.log(`   Reason:          ${ratio}x faster than ${second.network} (${formatMs(bestTime)} vs ${formatMs(secondTime)})`);

      if (unhealthyNetworks.length > 0) {
        console.log(`   Skipped:         ${unhealthyNetworks.join(", ")} (unhealthy)`);
      }

      console.log();
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
