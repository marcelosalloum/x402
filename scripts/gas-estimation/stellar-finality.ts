import { Networks } from "@stellar/stellar-sdk";

export type StellarNetwork = "stellar-testnet" | "stellar-mainnet";

interface NetworkConfig {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
}

const networkConfigs: Record<StellarNetwork, NetworkConfig> = {
  "stellar-testnet": {
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
  },
  "stellar-mainnet": {
    rpcUrl: "https://mainnet.sorobanrpc.com",
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: Networks.PUBLIC,
  },
};

export interface StellarFinalityEstimate {
  network: StellarNetwork;
  softFinalitySeconds: number;
  hardFinalitySeconds: number;
  softFinalityFormatted: string;
  hardFinalityFormatted: string;
  finalityNotes: string;
  softFinalitySource: string;
  hardFinalitySource: string;
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}

interface HorizonLedger {
  closed_at: string;
  sequence: number;
}

interface HorizonResponse {
  _embedded: {
    records: HorizonLedger[];
  };
}

/**
 * Measure average ledger close time from Horizon API
 */
async function measureLedgerCloseTime(
  config: NetworkConfig
): Promise<{ seconds: number; source: string }> {
  try {
    const response = await fetch(
      `${config.horizonUrl}/ledgers?order=desc&limit=10`
    );

    if (!response.ok) {
      throw new Error(`Horizon API returned ${response.status}`);
    }

    const data: HorizonResponse = await response.json();
    const ledgers = data._embedded.records;

    if (ledgers.length < 2) {
      throw new Error("Insufficient ledger data");
    }

    const closeTimes: number[] = [];
    for (let i = 0; i < ledgers.length - 1; i++) {
      const currentTime = new Date(ledgers[i].closed_at).getTime();
      const nextTime = new Date(ledgers[i + 1].closed_at).getTime();
      const diffSeconds = (currentTime - nextTime) / 1000;
      closeTimes.push(diffSeconds);
    }

    const averageCloseTime =
      closeTimes.reduce((sum, time) => sum + time, 0) / closeTimes.length;

    return {
      seconds: averageCloseTime,
      source: `Measured from last ${
        ledgers.length
      } ledgers (avg: ${averageCloseTime.toFixed(2)}s, range: ${Math.min(
        ...closeTimes
      ).toFixed(1)}s-${Math.max(...closeTimes).toFixed(1)}s)`,
    };
  } catch (error) {
    return {
      seconds: 5,
      source: `Fallback: Stellar protocol target is 5s per ledger (Horizon query failed: ${
        error instanceof Error ? error.message : "unknown"
      })`,
    };
  }
}

export async function getStellarFinality(
  network: StellarNetwork = "stellar-testnet"
): Promise<StellarFinalityEstimate> {
  const config = networkConfigs[network];
  if (!config) {
    throw new Error(
      `Unsupported network: ${network}. Supported: ${Object.keys(
        networkConfigs
      ).join(", ")}`
    );
  }

  const ledgerTime = await measureLedgerCloseTime(config);

  const finalityNotes =
    "Stellar uses SCP consensus. Soft and hard finality are equivalent (1 ledger close)";

  return {
    network,
    softFinalitySeconds: ledgerTime.seconds,
    hardFinalitySeconds: ledgerTime.seconds,
    softFinalityFormatted: formatSeconds(ledgerTime.seconds),
    hardFinalityFormatted: formatSeconds(ledgerTime.seconds),
    finalityNotes,
    softFinalitySource: ledgerTime.source,
    hardFinalitySource: "Same as soft (SCP provides immediate finality)",
  };
}

// --- CLI Execution ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("\nUsage: pnpm stellar-finality [network]");
    console.log("\nArguments:");
    console.log(
      "  network           Stellar network: 'testnet'/'stellar-testnet' (default), 'mainnet'/'stellar-mainnet'"
    );
    console.log("\nOptions:");
    console.log("  --list            List all supported networks");
    printSupportedNetworks();
    return;
  }

  if (args.includes("--list")) {
    printSupportedNetworks();
    return;
  }

  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const networkInput = positionalArgs[0] ?? "stellar-testnet";

  // Map network aliases
  const networkAliases: Record<string, StellarNetwork> = {
    testnet: "stellar-testnet",
    "stellar-testnet": "stellar-testnet",
    mainnet: "stellar-mainnet",
    "stellar-mainnet": "stellar-mainnet",
  };

  const network =
    networkAliases[networkInput] ?? (networkInput as StellarNetwork);

  if (!networkConfigs[network]) {
    console.error(`❌ Unknown network: ${network}`);
    printSupportedNetworks();
    process.exit(1);
  }

  console.log(`\n⭐ Stellar Finality Times (${network})\n${"=".repeat(40)}`);
  console.log("Measuring live network data...\n");

  try {
    const estimate = await getStellarFinality(network);

    console.log(`Network:          ${estimate.network}`);
    console.log(`Soft Finality:    ${estimate.softFinalityFormatted}`);
    console.log(`  Source:         ${estimate.softFinalitySource}`);
    console.log(`Hard Finality:    ${estimate.hardFinalityFormatted}`);
    console.log(`  Source:         ${estimate.hardFinalitySource}`);
    console.log(`Notes:            ${estimate.finalityNotes}`);
    console.log();
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function printSupportedNetworks() {
  console.log("\nSupported networks:");
  for (const [name, config] of Object.entries(networkConfigs)) {
    console.log(`  ${name.padEnd(18)} (${config.rpcUrl})`);
  }
  console.log();
}

import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
