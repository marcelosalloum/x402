#!/usr/bin/env npx tsx
import { getEvmFeeCost, type EvmCostEstimate } from "./evm-gas.js";
import { getStellarFeeCost, type StellarCostEstimate } from "./stellar-fee.js";
import { formatEther } from "viem";

type EvmNetwork = "base" | "base-sepolia";

type StellarNetwork = "stellar-testnet" | "stellar-mainnet";

interface ComparisonResult {
  evm: EvmCostEstimate;
  stellar: StellarCostEstimate;
  recommendation: "evm" | "stellar";
  reason: string;
}

async function compareNetworkCosts(
  evmNetwork: EvmNetwork,
  stellarNetwork: StellarNetwork,
  evmSponsored: boolean,
  stellarSponsored: boolean
): Promise<ComparisonResult> {
  const [evm, stellar] = await Promise.all([
    getEvmFeeCost(evmNetwork, evmSponsored),
    getStellarFeeCost(stellarNetwork, stellarSponsored),
  ]);

  const evmCostUsdc = Number(evm.estimatedCostUsdc);
  const stellarCostUsdc = Number(stellar.simulatedFeeUsdc);

  let recommendation: "evm" | "stellar";
  let reason: string;

  if (evm.isSponsored && !stellar.isSponsored) {
    recommendation = "evm";
    reason = "EVM fees are sponsored (0 USDC)";
  } else if (stellar.isSponsored && !evm.isSponsored) {
    recommendation = "stellar";
    reason = "Stellar fees are sponsored (0 USDC)";
  } else if (evm.isSponsored && stellar.isSponsored) {
    recommendation = "stellar";
    reason = "Both sponsored (0 USDC) - Stellar has faster finality";
  } else if (stellarCostUsdc < evmCostUsdc) {
    recommendation = "stellar";
    const multiplier = (evmCostUsdc / stellarCostUsdc).toFixed(1);
    reason = `Stellar is cheaper (EVM is ${multiplier}x more expensive: ${stellar.simulatedFeeUsdc} vs ${evm.estimatedCostUsdc} USDC)`;
  } else {
    recommendation = "evm";
    const multiplier = (stellarCostUsdc / evmCostUsdc).toFixed(1);
    reason = `EVM is cheaper (Stellar is ${multiplier}x more expensive: ${evm.estimatedCostUsdc} vs ${stellar.simulatedFeeUsdc} USDC)`;
  }

  return { evm, stellar, recommendation, reason };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "\nUsage: pnpm compare [evm-network] [stellar-network] [options]"
    );
    console.log("\nArguments:");
    console.log(
      "  evm-network       EVM network to compare (default: base-sepolia)"
    );
    console.log(
      "  stellar-network   Stellar network: 'stellar'/'testnet' (default: stellar-testnet), 'stellar-mainnet' or 'mainnet'"
    );
    console.log("\nOptions:");
    console.log("  --evm-sponsored   Mark EVM as sponsored (cost = 0)");
    console.log("  --stellar-sponsored  Mark Stellar as sponsored (cost = 0)");
    console.log("\nExamples:");
    console.log(
      "  pnpm compare                      # base-sepolia vs stellar-testnet"
    );
    console.log(
      "  pnpm compare base stellar         # base vs stellar-testnet"
    );
    console.log(
      "  pnpm compare base-sepolia stellar-testnet  # explicit network names"
    );
    console.log(
      "  pnpm compare base-sepolia stellar-mainnet  # base-sepolia vs stellar mainnet"
    );
    console.log("  pnpm compare base --evm-sponsored");
    console.log();
    return;
  }

  const evmSponsored = args.includes("--evm-sponsored");
  const stellarSponsored = args.includes("--stellar-sponsored");

  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const evmNetwork = (positionalArgs[0] ?? "base-sepolia") as EvmNetwork;

  // Handle stellar network aliases for consistency with pnpm stellar command
  const stellarNetworkInput = positionalArgs[1] ?? "stellar-testnet";

  const networkAliases: Record<string, StellarNetwork> = {
    testnet: "stellar-testnet",
    "stellar-testnet": "stellar-testnet",
    stellar: "stellar-testnet",
    mainnet: "stellar-mainnet",
    "stellar-mainnet": "stellar-mainnet",
  };

  const stellarNetwork =
    networkAliases[stellarNetworkInput] ??
    (stellarNetworkInput as StellarNetwork);

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       x402 Economic Load Balancer - Cost Comparison          ║
╚══════════════════════════════════════════════════════════════╝
`);

  try {
    const result = await compareNetworkCosts(
      evmNetwork,
      stellarNetwork,
      evmSponsored,
      stellarSponsored
    );

    console.log(
      `⛽ ${result.evm.network} (EVM)${result.evm.isL2 ? " [L2]" : ""}`
    );
    console.log("─".repeat(40));
    console.log(`   Chain ID:     ${result.evm.chainId}`);
    console.log(`   Gas Price:    ${result.evm.gasPriceGwei} Gwei`);
    console.log(`   Gas Limit:    ${result.evm.estimatedGasUnits} units`);
    if (result.evm.isL2) {
      const l2Cost = formatEther(result.evm.l2ExecutionCostWei);
      const l1Cost = formatEther(result.evm.l1DataCostWei);
      console.log(
        `   L2 Execution: ${l2Cost} ${result.evm.nativeSymbol} (${result.evm.l2ExecutionCostWei} wei)`
      );
      console.log(
        `   L1 Data Fee:  ${l1Cost} ${result.evm.nativeSymbol} (${result.evm.l1DataCostWei} wei)`
      );
    }
    console.log(
      `   Total Cost:   ${result.evm.estimatedCostNative} ${result.evm.nativeSymbol}`
    );
    console.log(`   Total Cost:   ${result.evm.estimatedCostUsdc} USDC`);
    console.log(
      `   Price Rate:   1 ${
        result.evm.nativeSymbol
      } = $${result.evm.nativeUsdPrice.toFixed(2)} USD`
    );
    console.log(`   Sponsored:    ${result.evm.isSponsored ? "Yes ✅" : "No"}`);
    console.log(
      `   Simulated:    ${result.evm.isSimulated ? "Yes" : "No (fallback)"}`
    );
    console.log(`   Method:       EIP-3009 transferWithAuthorization`);

    console.log(`\n⭐ ${result.stellar.network} (Stellar)`);
    console.log("─".repeat(40));
    console.log(`   Token:        ${result.stellar.tokenLabel}`);
    console.log(`   Contract:     ${result.stellar.tokenContract}`);
    console.log(
      `   Total Fee:    ${result.stellar.simulatedFeeStroops} stroops (${result.stellar.simulatedFeeXlm} XLM)`
    );
    console.log(`   Total Fee:    ${result.stellar.simulatedFeeUsdc} USDC`);
    console.log(
      `   Price Rate:   1 XLM = $${result.stellar.xlmUsdPrice.toFixed(4)} USD`
    );
    console.log(
      `   Sponsored:    ${result.stellar.isSponsored ? "Yes ✅" : "No"}`
    );
    console.log(
      `   Simulated:    ${result.stellar.isSimulated ? "Yes" : "No (fallback)"}`
    );
    console.log(`   Method:       Soroban token transfer (SEP-41 style)`);

    console.log("\n🏆 Recommendation");
    console.log("─".repeat(40));
    console.log(
      `   Best Option:  ${
        result.recommendation === "stellar"
          ? `⭐ ${result.stellar.network}`
          : `⛽ ${result.evm.network}`
      }`
    );
    console.log(`   Reason:       ${result.reason}`);
    console.log();
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
