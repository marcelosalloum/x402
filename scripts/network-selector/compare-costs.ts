#!/usr/bin/env npx tsx
/**
 * Compare costs across multiple networks
 * Supports any number of networks in any order
 */

import { NetworkAnalysis } from "./network-analysis.js";
import type { SupportedNetwork, CostEstimate, NetworkHealth } from "./types.js";

const ALL_NETWORKS: SupportedNetwork[] = [
  "base",
  "base-sepolia",
  "stellar-testnet",
  "stellar-mainnet",
];

const NETWORK_ALIASES: Record<string, SupportedNetwork> = {
  base: "base",
  "base-sepolia": "base-sepolia",
  stellar: "stellar-testnet",
  testnet: "stellar-testnet",
  "stellar-testnet": "stellar-testnet",
  mainnet: "stellar-mainnet",
  "stellar-mainnet": "stellar-mainnet",
};

interface NetworkCostResult {
  network: SupportedNetwork;
  cost: CostEstimate;
  health?: NetworkHealth;
  isSponsored: boolean;
}

function parseNetworks(args: string[]): SupportedNetwork[] {
  const positionalArgs = args.filter((a) => !a.startsWith("--"));

  if (positionalArgs.length === 0) {
    // Default: base-sepolia and stellar-testnet
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

function parseSponsoredNetworks(args: string[]): Set<SupportedNetwork> {
  const sponsored = new Set<SupportedNetwork>();

  for (const arg of args) {
    if (arg.startsWith("--sponsored=")) {
      const networkArg = arg.split("=")[1];
      const network = NETWORK_ALIASES[networkArg];
      if (network) sponsored.add(network);
    }
  }

  // Legacy flags for backwards compatibility
  if (args.includes("--evm-sponsored")) {
    sponsored.add("base");
    sponsored.add("base-sepolia");
  }
  if (args.includes("--stellar-sponsored")) {
    sponsored.add("stellar-testnet");
    sponsored.add("stellar-mainnet");
  }

  return sponsored;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("\nUsage: pnpm compare [networks...] [options]");
    console.log("\nArguments:");
    console.log("  networks          One or more networks to compare (order doesn't matter)");
    console.log("                    Default: base-sepolia stellar-testnet");
    console.log("\nOptions:");
    console.log("  --sponsored=<network>  Mark a network as sponsored (can be repeated)");
    console.log("  --evm-sponsored        Mark all EVM networks as sponsored");
    console.log("  --stellar-sponsored    Mark all Stellar networks as sponsored");
    console.log("  --skip-unhealthy       Skip unhealthy networks (default: true)");
    console.log("  --no-skip-unhealthy    Include unhealthy networks");
    console.log("  --list                 List all supported networks");
    console.log("\nExamples:");
    console.log("  pnpm compare                                    # base-sepolia vs stellar-testnet");
    console.log("  pnpm compare base stellar-mainnet               # base vs stellar-mainnet");
    console.log("  pnpm compare base base-sepolia stellar          # 3-way comparison");
    console.log("  pnpm compare stellar base                       # order doesn't matter");
    console.log("  pnpm compare base --sponsored=base              # base with sponsored fees");
    console.log("  pnpm compare base stellar --stellar-sponsored   # stellar sponsored");
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

  const networks = parseNetworks(args);
  const sponsoredNetworks = parseSponsoredNetworks(args);
  const skipUnhealthy = !args.includes("--no-skip-unhealthy");

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       x402 Economic Load Balancer - Cost Comparison          ║
╚══════════════════════════════════════════════════════════════╝
`);

  const analysis = new NetworkAnalysis({
    healthCheckEnabled: skipUnhealthy,
  });

  try {
    // Check health and get estimates
    const results: NetworkCostResult[] = [];
    const unhealthyNetworks: SupportedNetwork[] = [];

    for (const network of networks) {
      const isSponsored = sponsoredNetworks.has(network);

      if (skipUnhealthy) {
        const health = await analysis.checkHealth(network);
        if (health.status === "unhealthy") {
          unhealthyNetworks.push(network);
          console.log(`⚠️  ${network} is unhealthy (${health.error}) - skipping\n`);
          continue;
        }
      }

      const cost = await analysis.estimateCost(network, isSponsored);
      results.push({ network, cost, isSponsored });
    }

    if (results.length === 0) {
      console.error("❌ All networks are unhealthy");
      process.exit(1);
    }

    // Sort by cost (lowest first)
    results.sort((a, b) => {
      if (a.cost.isSponsored && !b.cost.isSponsored) return -1;
      if (!a.cost.isSponsored && b.cost.isSponsored) return 1;
      return parseFloat(a.cost.feeUsdc) - parseFloat(b.cost.feeUsdc);
    });

    // Display each network
    for (const result of results) {
      const { network, cost } = result;
      const icon = cost.networkFamily === "evm" ? "⛽" : "⭐";
      const familyLabel = cost.networkFamily.toUpperCase();

      console.log(`${icon} ${network} (${familyLabel})`);
      console.log("─".repeat(40));
      console.log(`   Fee:          ${cost.feeUsdc} USDC`);
      console.log(`                 (${cost.feeNative} ${cost.nativeSymbol})`);
      console.log(`   Price Rate:   1 ${cost.nativeSymbol} = $${cost.nativeUsdPrice.toFixed(4)} USD`);
      console.log(`   Sponsored:    ${cost.isSponsored ? "Yes ✅" : "No"}`);
      console.log(`   Simulated:    ${cost.isSimulated ? "Yes" : "No (fallback)"}`);
      console.log();
    }

    // Show recommendation
    if (results.length > 1) {
      const best = results[0];
      const bestCost = parseFloat(best.cost.feeUsdc);

      console.log("🏆 Recommendation");
      console.log("─".repeat(40));

      const icon = best.cost.networkFamily === "evm" ? "⛽" : "⭐";
      console.log(`   Best Option:  ${icon} ${best.network} (${best.cost.feeUsdc} USDC)`);

      if (best.cost.isSponsored) {
        console.log(`   Reason:       Sponsored (0 USDC fee)`);
      } else {
        // Show comparison against all other networks
        console.log(`   vs others:`);
        for (let i = 1; i < results.length; i++) {
          const other = results[i];
          const otherCost = parseFloat(other.cost.feeUsdc);
          if (other.cost.isSponsored) {
            console.log(`     • ${other.network}: sponsored (0 USDC)`);
          } else {
            const ratio = (otherCost / bestCost).toFixed(1);
            console.log(`     • ${other.network}: ${ratio}x more expensive (${other.cost.feeUsdc} USDC)`);
          }
        }
      }

      if (unhealthyNetworks.length > 0) {
        console.log(`   Skipped:      ${unhealthyNetworks.join(", ")} (unhealthy)`);
      }

      console.log();
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
