#!/usr/bin/env npx tsx
import { getEvmFinality, type EvmFinalityEstimate } from "./evm-finality.js";
import {
  getStellarFinality,
  type StellarFinalityEstimate,
} from "./stellar-finality.js";

type EvmNetwork = "base" | "base-sepolia";
type StellarNetwork = "stellar-testnet" | "stellar-mainnet";
type FinalityType = "soft" | "hard";

interface FinalityComparisonResult {
  evm: EvmFinalityEstimate;
  stellar: StellarFinalityEstimate;
  recommendation: "evm" | "stellar";
  reason: string;
}

async function compareFinality(
  evmNetwork: EvmNetwork,
  stellarNetwork: StellarNetwork,
  finalityType: FinalityType
): Promise<FinalityComparisonResult> {
  const [evm, stellar] = await Promise.all([
    getEvmFinality(evmNetwork),
    getStellarFinality(stellarNetwork),
  ]);

  const evmTime =
    finalityType === "soft" ? evm.softFinalitySeconds : evm.hardFinalitySeconds;
  const stellarTime =
    finalityType === "soft"
      ? stellar.softFinalitySeconds
      : stellar.hardFinalitySeconds;

  let recommendation: "evm" | "stellar";
  let reason: string;

  const evmFormatted =
    finalityType === "soft"
      ? evm.softFinalityFormatted
      : evm.hardFinalityFormatted;
  const stellarFormatted =
    finalityType === "soft"
      ? stellar.softFinalityFormatted
      : stellar.hardFinalityFormatted;

  if (stellarTime < evmTime) {
    recommendation = "stellar";
    const ratio = (evmTime / stellarTime).toFixed(1);
    reason = `Stellar is ${ratio}x faster (${stellarFormatted} vs ${evmFormatted})`;
  } else if (evmTime < stellarTime) {
    recommendation = "evm";
    const ratio = (stellarTime / evmTime).toFixed(1);
    reason = `EVM is ${ratio}x faster (${evmFormatted} vs ${stellarFormatted})`;
  } else {
    recommendation = "stellar";
    reason = `Both have equal ${finalityType} finality (${evmFormatted})`;
  }

  return { evm, stellar, recommendation, reason };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "\nUsage: pnpm compare:finality [evm-network] [stellar-network] [options]"
    );
    console.log("\nArguments:");
    console.log(
      "  evm-network       EVM network to compare (default: base-sepolia)"
    );
    console.log(
      "  stellar-network   Stellar network: 'testnet'/'stellar-testnet' (default), 'mainnet'/'stellar-mainnet'"
    );
    console.log("\nOptions:");
    console.log(
      "  --type=<soft|hard>  Finality type to compare (default: soft)"
    );
    console.log("\nExamples:");
    console.log(
      "  pnpm compare:finality                    # base-sepolia vs stellar-testnet (soft)"
    );
    console.log(
      "  pnpm compare:finality base mainnet       # base vs stellar-mainnet (soft)"
    );
    console.log(
      "  pnpm compare:finality base testnet --type=hard  # hard finality comparison"
    );
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

  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const evmNetwork = (positionalArgs[0] ?? "base-sepolia") as EvmNetwork;

  const stellarNetworkInput = positionalArgs[1] ?? "stellar-testnet";
  const networkAliases: Record<string, StellarNetwork> = {
    testnet: "stellar-testnet",
    "stellar-testnet": "stellar-testnet",
    mainnet: "stellar-mainnet",
    "stellar-mainnet": "stellar-mainnet",
  };
  const stellarNetwork =
    networkAliases[stellarNetworkInput] ??
    (stellarNetworkInput as StellarNetwork);

  console.log(`
╔═════════════════════════════════════════════════════════════╗
║     x402 Economic Load Balancer - Finality Comparison       ║
║                       (${finalityType.toUpperCase()} Finality)${" ".repeat(
    27 - finalityType.length
  )}║
╚═════════════════════════════════════════════════════════════╝
`);

  console.log("Measuring live network data...\n");

  try {
    const result = await compareFinality(
      evmNetwork,
      stellarNetwork,
      finalityType
    );

    console.log(
      `⛽ ${result.evm.network} (EVM)${result.evm.isL2 ? " [L2]" : ""}`
    );
    console.log("─".repeat(40));
    console.log(`   Chain ID:         ${result.evm.chainId}`);
    console.log(`   Soft Finality:    ${result.evm.softFinalityFormatted}`);
    console.log(`   Hard Finality:    ${result.evm.hardFinalityFormatted}`);
    console.log(`   Notes:            ${result.evm.finalityNotes}`);

    console.log(`\n⭐ ${result.stellar.network} (Stellar)`);
    console.log("─".repeat(40));
    console.log(`   Soft Finality:    ${result.stellar.softFinalityFormatted}`);
    console.log(`   Hard Finality:    ${result.stellar.hardFinalityFormatted}`);
    console.log(`   Notes:            ${result.stellar.finalityNotes}`);

    console.log("\n🏆 Recommendation");
    console.log("─".repeat(40));
    console.log(
      `   Best Option:      ${
        result.recommendation === "stellar"
          ? `⭐ ${result.stellar.network}`
          : `⛽ ${result.evm.network}`
      }`
    );
    console.log(`   Reason:           ${result.reason}`);
    console.log();
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
