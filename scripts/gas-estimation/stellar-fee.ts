#!/usr/bin/env npx tsx
import {
  rpc,
  Networks,
  Keypair,
  nativeToScVal,
  TransactionBuilder,
  Contract,
} from "@stellar/stellar-sdk";
import { getCryptoPrice } from "./utils.js";

const STROOPS_PER_XLM = 10_000_000;

// Fallback XLM price if API fails

type StellarNetwork = "stellar-testnet" | "stellar-mainnet";

interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  // Native XLM token contract (no trustlines required)
  nativeXlmTokenContract: string;
  // Funded test wallet for simulation
  testWallet: {
    secret: string;
    public: string;
  };
}

// Test wallets for simulation (both must exist on the network)
const testWallets = {
  source: {
    secret: "SBZHWNUIF546QRIUMZ2JA5U42WSNWOZPRSSSRSMA4GF2HFGKOHFOO5XH",
    public: "GAQPBE3LXAMZZ2KBRDAILOZ26Q5Y7VGUP7V3C3JTJF4IUZDB75FTMFIE",
  },
  destination: {
    public: "GCHEI4PQEFJOA27MNZRPQNLGURS6KASW76X5UZCUZIXCOJLKXYCXOR2W",
  },
};

const networkConfigs: Record<StellarNetwork, NetworkConfig> = {
  "stellar-testnet": {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
    // Native XLM contract on testnet - no trustlines needed
    nativeXlmTokenContract:
      "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    testWallet: testWallets.source,
  },
  "stellar-mainnet": {
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: Networks.PUBLIC,
    // Native XLM contract on mainnet
    nativeXlmTokenContract:
      "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
    testWallet: testWallets.source,
  },
};

export interface StellarCostEstimate {
  network: StellarNetwork;
  tokenLabel: string;
  tokenContract: string;
  xlmUsdPrice: number;
  simulatedFeeStroops: number;
  simulatedFeeXlm: string;
  simulatedFeeUsdc: string;
  isSponsored: boolean;
  isSimulated: boolean;
}

export async function getStellarFeeCost(
  network: StellarNetwork = "stellar-testnet",
  isSponsored: boolean = false,
  customRpcUrl?: string,
  tokenContractOverride?: string
): Promise<StellarCostEstimate> {
  const config = networkConfigs[network];

  // Fetch live price
  const livePrice = await getCryptoPrice("XLM");
  const xlmUsdPrice = livePrice > 0 ? livePrice : 0.25; // Fallback price

  const tokenContract = tokenContractOverride ?? config.nativeXlmTokenContract;
  const tokenLabel = tokenContractOverride ? "custom-token" : "native-xlm";

  if (isSponsored) {
    return {
      network,
      tokenLabel,
      tokenContract,
      xlmUsdPrice,
      simulatedFeeStroops: 0,
      simulatedFeeXlm: "0",
      simulatedFeeUsdc: "0.000000",
      isSponsored: true,
      isSimulated: false,
    };
  }

  const rpcUrl = customRpcUrl ?? config.rpcUrl;
  const server = new rpc.Server(rpcUrl);

  let simulatedFee = 0;
  let isSimulated = false;

  try {
    // Use funded test wallets (both must exist on the network)
    const sourceKeypair = Keypair.fromSecret(config.testWallet.secret);
    const destinationPublic = testWallets.destination.public;

    // Get the source account from the network
    const sourceAccount = await server.getAccount(sourceKeypair.publicKey());

    // Build contract call for a token transfer.
    // Default is the native XLM token contract (no trustlines required).
    // If you want to simulate USDC specifically, pass --contract=<TOKEN_CONTRACT_ID>
    // (and ensure the funded test wallet can successfully transfer it).
    const contract = new Contract(tokenContract);
    const transferOp = contract.call(
      "transfer",
      nativeToScVal(sourceKeypair.publicKey(), { type: "address" }), // from
      nativeToScVal(destinationPublic, { type: "address" }), // to
      nativeToScVal("1000000", { type: "i128" }) // amount (0.1 XLM)
    );

    // Build transaction
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: "100", // Base fee, will be replaced by simulation
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(transferOp)
      .setTimeout(30)
      .build();

    // Simulate the transaction to get actual resource fees
    const simulation = await server.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(simulation)) {
      // Get the resource fee from simulation
      const resourceFee = Number(simulation.minResourceFee);
      // Get inclusion fee from fee stats
      const feeStats = await server.getFeeStats();
      const inclusionFee = Number(
        feeStats.sorobanInclusionFee.p95 || feeStats.sorobanInclusionFee.max
      );

      simulatedFee = resourceFee + inclusionFee;
      isSimulated = true;
    } else {
      // Simulation failed - use fallback
      console.warn("❌ Simulation failed - using fallback fee");
      simulatedFee = 70000;
    }
  } catch (error) {
    console.error(
      "❌ Simulation crashed:",
      error instanceof Error ? error.message : error
    );
    // RPC error (e.g., account not found on mainnet) - use fallback
    simulatedFee = 92000; // Based on testnet simulation
  }

  const feeXlm = simulatedFee / STROOPS_PER_XLM;

  return {
    network,
    tokenLabel,
    tokenContract,
    xlmUsdPrice,
    simulatedFeeStroops: simulatedFee,
    simulatedFeeXlm: feeXlm.toFixed(7),
    simulatedFeeUsdc: (feeXlm * xlmUsdPrice).toFixed(6),
    isSponsored: false,
    isSimulated,
  };
}

function printSupportedNetworks() {
  console.log("\nSupported networks:");
  for (const [name, config] of Object.entries(networkConfigs)) {
    console.log(`  ${name.padEnd(18)} (${config.rpcUrl})`);
  }
  console.log();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("\nUsage: pnpm stellar [network] [options]");
    console.log("\nArguments:");
    console.log(
      "  network           Stellar network: 'testnet'/'stellar' (default: stellar-testnet), 'mainnet'/'stellar-mainnet'"
    );
    console.log("\nOptions:");
    console.log("  --sponsored       Mark as sponsored (cost = 0)");
    console.log("  --rpc=<url>       Custom RPC URL");
    console.log(
      "  --contract=<id>   Token contract to simulate (default: native XLM token contract)"
    );
    console.log("  --list            List all supported networks");
    printSupportedNetworks();
    return;
  }

  if (args.includes("--list")) {
    printSupportedNetworks();
    return;
  }

  const isSponsored = args.includes("--sponsored");
  const customRpc = args.find((a) => a.startsWith("--rpc="))?.split("=")[1];
  const tokenContract = args
    .find((a) => a.startsWith("--contract="))
    ?.split("=")[1];
  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const networkInput = positionalArgs[0];
  if (!networkInput) {
    console.error("❌ No network provided");
    printSupportedNetworks();
    process.exit(1);
  }

  // Map network aliases to canonical network names
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

  console.log(`\n⭐ Stellar Fee Estimation (${network})\n${"=".repeat(40)}`);

  if (isSponsored) {
    console.log("💰 Transaction is SPONSORED by facilitator\n");
  }

  try {
    const estimate = await getStellarFeeCost(
      network,
      isSponsored,
      customRpc,
      tokenContract
    );

    console.log(`Network:        ${estimate.network}`);
    console.log(
      `RPC:            ${customRpc ?? networkConfigs[network].rpcUrl}`
    );
    console.log(`Token:          ${estimate.tokenLabel}`);
    console.log(`Contract:       ${estimate.tokenContract}`);
    console.log(
      `Total Fee:      ${estimate.simulatedFeeStroops} stroops (${estimate.simulatedFeeXlm} XLM)`
    );
    console.log(`Total Fee:      ${estimate.simulatedFeeUsdc} USDC`);
    console.log(
      `Price Rate:     1 XLM = $${estimate.xlmUsdPrice.toFixed(4)} USD`
    );
    console.log(`Sponsored:      ${estimate.isSponsored ? "Yes ✅" : "No"}`);
    console.log(
      `Simulated:      ${
        estimate.isSimulated ? "Yes (transfer simulation)" : "No (fallback)"
      }`
    );
    console.log(`Method:         Soroban token transfer (SEP-41 style)`);
    console.log();
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Only run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
