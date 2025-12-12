#!/usr/bin/env npx tsx
/**
 * Demo: x402 Economic Load Balancer
 *
 * Demonstrates the NetworkAnalysis and PaymentRanker classes.
 */

import { NetworkAnalysis, PaymentRanker } from "./index.js";
import type { PaymentRequirement } from "./types.js";

// Sample x402 payment requirements (as would be returned by a 402 response)
const samplePaymentRequirements: PaymentRequirement[] = [
  {
    network: "base-sepolia",
    amount: "1000000", // 1 USDC (6 decimals)
    asset: "USDC",
    payTo: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    description: "Access premium API endpoint",
  },
  {
    network: "stellar-testnet",
    amount: "1000000", // 1 USDC (7 decimals for Stellar)
    asset: "USDC",
    payTo: "GCHEI4PQEFJOA27MNZRPQNLGURS6KASW76X5UZCUZIXCOJLKXYCXOR2W",
    description: "Access premium API endpoint",
  },
];

async function demoNetworkAnalysis() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       x402 Economic Load Balancer - NetworkAnalysis Demo     ║
╚══════════════════════════════════════════════════════════════╝
`);

  const analysis = new NetworkAnalysis({ cacheTtlMs: 60_000 });

  console.log("📊 Fetching network estimates...\n");

  // Get estimates for both networks
  const networks = analysis.getSupportedNetworks();
  console.log(`Supported networks: ${networks.join(", ")}\n`);

  for (const network of ["base-sepolia", "stellar-testnet"] as const) {
    console.log(`─── ${network} ───`);

    const estimate = await analysis.getNetworkEstimate(network);

    console.log(`  Cost:     ${estimate.cost.feeUsdc} USDC`);
    console.log(`            (${estimate.cost.feeNative} ${estimate.cost.nativeSymbol})`);
    console.log(`  Finality: ${(estimate.finality.softFinalityMs / 1000).toFixed(1)}s (soft)`);
    console.log(`            ${(estimate.finality.hardFinalityMs / 1000).toFixed(1)}s (hard)`);
    console.log(`  Simulated: ${estimate.cost.isSimulated ? "Yes" : "No (fallback)"}`);
    console.log();
  }

  // Demonstrate caching
  console.log("🔄 Testing cache...");
  const cacheStats = analysis.getCacheStats();
  console.log(`  Cached entries: ${cacheStats.costCacheSize + cacheStats.finalityCacheSize + cacheStats.healthCacheSize}`);
  console.log(`  Networks: ${cacheStats.cachedNetworks.join(", ")}`);
  console.log();
}

async function demoHealthCheck() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       x402 Economic Load Balancer - Health Check Demo        ║
╚══════════════════════════════════════════════════════════════╝
`);

  const analysis = new NetworkAnalysis({
    healthCheckEnabled: true,
    healthCheckTimeoutMs: 5000,
  });

  console.log("🏥 Checking network health...\n");

  for (const network of ["base-sepolia", "stellar-testnet"] as const) {
    const health = await analysis.checkHealth(network);

    const statusIcon = health.status === "healthy" ? "🟢" :
                       health.status === "degraded" ? "🟡" :
                       health.status === "unhealthy" ? "🔴" : "⚪";

    console.log(`${statusIcon} ${network}`);
    console.log(`   Status:   ${health.status}`);
    console.log(`   Latency:  ${health.latencyMs}ms`);
    if (health.error) {
      console.log(`   Error:    ${health.error}`);
    }
    console.log();
  }

  // Get only healthy networks
  const allNetworks = analysis.getSupportedNetworks();
  const healthyNetworks = await analysis.getHealthyNetworks(allNetworks);
  console.log(`✅ Healthy networks: ${healthyNetworks.join(", ")}`);
  console.log();
}

async function demoPaymentRanker() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║         x402 Economic Load Balancer - PaymentRanker Demo     ║
╚══════════════════════════════════════════════════════════════╝
`);

  const ranker = new PaymentRanker({ cacheTtlMs: 60_000 });

  console.log("📋 Payment Requirements:");
  samplePaymentRequirements.forEach((req, i) => {
    console.log(`  ${i + 1}. ${req.network}: ${req.amount} ${req.asset}`);
  });
  console.log();

  // Rank by lowest cost
  console.log("💰 Ranking by LOWEST COST...\n");
  const costResult = await ranker.rank(samplePaymentRequirements, "lowest-cost");

  console.log("  Ranked options:");
  costResult.rankedOptions.forEach((opt, i) => {
    const marker = i === 0 ? "🏆" : "  ";
    console.log(`    ${marker} ${i + 1}. ${opt.requirement.network}: ${opt.costUsdc} USDC`);
  });
  console.log(`\n  ✅ Best: ${costResult.best.network}`);
  console.log(`     Reason: ${costResult.reason}`);
  if (costResult.unhealthyNetworks?.length) {
    console.log(`     Skipped: ${costResult.unhealthyNetworks.join(", ")} (unhealthy)`);
  }
  console.log();

  // Rank by fastest finality
  console.log("⚡ Ranking by FASTEST FINALITY...\n");
  const finalityResult = await ranker.rank(samplePaymentRequirements, "fastest-finality");

  console.log("  Ranked options:");
  finalityResult.rankedOptions.forEach((opt, i) => {
    const marker = i === 0 ? "🏆" : "  ";
    const timeStr = opt.finalityMs < 1000
      ? `${opt.finalityMs}ms`
      : `${(opt.finalityMs / 1000).toFixed(1)}s`;
    console.log(`    ${marker} ${i + 1}. ${opt.requirement.network}: ${timeStr}`);
  });
  console.log(`\n  ✅ Best: ${finalityResult.best.network}`);
  console.log(`     Reason: ${finalityResult.reason}`);
  console.log();
}

async function demoSponsoredPayments() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║      x402 Economic Load Balancer - Sponsored Payments Demo   ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Create ranker with stellar-testnet as sponsored
  const ranker = new PaymentRanker({
    cacheTtlMs: 60_000,
    sponsoredNetworks: ["stellar-testnet"],
  });

  console.log("💎 Stellar fees are SPONSORED (0 USDC)\n");

  const result = await ranker.rank(samplePaymentRequirements, "lowest-cost");

  console.log("  Ranked options:");
  result.rankedOptions.forEach((opt, i) => {
    const marker = i === 0 ? "🏆" : "  ";
    const sponsored = opt.costUsdc === "0.000000" ? " (sponsored)" : "";
    console.log(`    ${marker} ${i + 1}. ${opt.requirement.network}: ${opt.costUsdc} USDC${sponsored}`);
  });
  console.log(`\n  ✅ Best: ${result.best.network}`);
  console.log(`     Reason: ${result.reason}`);
  console.log();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("\nUsage: pnpm demo [options]");
    console.log("\nOptions:");
    console.log("  --analysis    Run only NetworkAnalysis demo");
    console.log("  --health      Run only health check demo");
    console.log("  --ranker      Run only PaymentRanker demo");
    console.log("  --sponsored   Run sponsored payments demo");
    console.log("  --all         Run all demos (default)");
    console.log();
    return;
  }

  try {
    if (args.includes("--analysis")) {
      await demoNetworkAnalysis();
    } else if (args.includes("--health")) {
      await demoHealthCheck();
    } else if (args.includes("--ranker")) {
      await demoPaymentRanker();
    } else if (args.includes("--sponsored")) {
      await demoSponsoredPayments();
    } else {
      await demoNetworkAnalysis();
      await demoHealthCheck();
      await demoPaymentRanker();
      await demoSponsoredPayments();
    }

    console.log("✅ Demo completed successfully!\n");
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
