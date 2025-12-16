#!/usr/bin/env npx tsx
/**
 * x402 Economic Load Balancer - CLI Demo
 *
 * This CLI demonstrates intelligent network selection for x402 payments,
 * choosing the optimal network based on cost or finality criteria.
 */

import axios, { AxiosError } from "axios";
import { config } from "dotenv";
import { Command } from "commander";
import {
  withPaymentInterceptor,
  decodeXPaymentResponse,
  createSigner,
  type Hex,
  type PaymentRequirementsSelector,
} from "x402-axios";
import type { PaymentRequirements, SettleResponse } from "x402/types";
import {
  rankPaymentOptions,
  type PaymentOption,
  type RankingCriteria,
  type SupportedNetwork,
  type RankingResult,
} from "./network-ranker.js";

config();

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SERVER_URL = "http://localhost:4021";
const DEFAULT_ENDPOINT_PATH = "/premium/agent-insight";
const STELLAR_DECIMALS = 7;
const EVM_DECIMALS = 6;
const DISPLAY_DECIMAL_PLACES = 4;
const ANALYSIS_SEPARATOR_LENGTH = 60;

const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY as Hex | undefined;
const STELLAR_PRIVATE_KEY = process.env.STELLAR_PRIVATE_KEY as
  | string
  | undefined;

// ============================================================================
// Types
// ============================================================================

interface ErrorDetails {
  message: string;
  details?: string;
  isInsufficientFunds?: boolean;
}

// ============================================================================
// CLI Setup
// ============================================================================

const program = new Command();

program
  .name("x402-elb-cli")
  .description("x402 Economic Load Balancer - CLI Demo")
  .version("1.0.0")
  .option(
    "--criteria <type>",
    "Ranking criteria (lowest-cost | fastest-soft-finality | fastest-hard-finality)",
    "lowest-cost"
  )
  .option("--server <url>", "Resource server URL", DEFAULT_SERVER_URL)
  .option("--endpoint <path>", "Endpoint to request", DEFAULT_ENDPOINT_PATH)
  .option(
    "--dry-run",
    "Print payment instructions without executing payment",
    false
  )
  .addHelpText(
    "after",
    `
Examples:
  $ pnpm cli                                    # Choose cheapest network
  $ pnpm cli --criteria fastest-soft-finality   # Choose fastest soft finality
  $ pnpm cli --criteria fastest-hard-finality    # Choose fastest hard finality
  $ pnpm cli --server http://localhost:3000 --endpoint /weather

Valid criteria values:
  - lowest-cost           Choose the network with the lowest transaction cost
  - fastest-soft-finality Choose the network with the fastest soft finality (sequencer/ledger confirmation)
  - fastest-hard-finality Choose the network with the fastest hard finality (irreversible finality)
`
  );

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Formats milliseconds into a human-readable string (e.g., "2.5s", "1m 30s")
 */
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
}

/**
 * Gets the number of decimals for a network's native asset
 */
function getNetworkDecimals(network: string): number {
  return network.startsWith("stellar") ? STELLAR_DECIMALS : EVM_DECIMALS;
}

/**
 * Formats a payment amount for display
 */
function formatPaymentAmount(
  maxAmountRequired: string,
  network: string
): string {
  const decimals = getNetworkDecimals(network);
  const amount = Number(maxAmountRequired) / 10 ** decimals;
  return `$${amount.toFixed(DISPLAY_DECIMAL_PLACES)}`;
}

/**
 * Validates and returns the ranking criteria
 */
function validateCriteria(criteria: string): RankingCriteria {
  const validCriteria: RankingCriteria[] = [
    "lowest-cost",
    "fastest-soft-finality",
    "fastest-hard-finality",
  ];
  if (!validCriteria.includes(criteria as RankingCriteria)) {
    program.error(
      `Invalid criteria "${criteria}". Must be one of: ${validCriteria.join(
        ", "
      )}`
    );
  }
  return criteria as RankingCriteria;
}

/**
 * Checks if payment execution is possible (private keys configured)
 */
function canExecutePayment(): boolean {
  return !!(EVM_PRIVATE_KEY || STELLAR_PRIVATE_KEY);
}

/**
 * Checks if an error message indicates insufficient funds
 */
function isInsufficientFundsError(message: string): boolean {
  const lowerMsg = message.toLowerCase();
  return (
    lowerMsg.includes("gas required exceeds allowance") ||
    lowerMsg.includes("insufficient funds") ||
    lowerMsg.includes("insufficient balance") ||
    lowerMsg.includes("allowance") ||
    lowerMsg.includes("balance") ||
    lowerMsg.includes("gas")
  );
}

// ============================================================================
// Display Functions
// ============================================================================

/**
 * Prints the CLI header
 */
function printHeader(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       x402 Economic Load Balancer - CLI Demo                 ║
╚══════════════════════════════════════════════════════════════╝
`);
}

/**
 * Prints configuration summary
 */
function printConfiguration(
  serverUrl: string,
  endpointPath: string,
  criteria: RankingCriteria
): void {
  console.log(`📋 Configuration:`);
  console.log(`   Server:    ${serverUrl}`);
  console.log(`   Endpoint:  ${endpointPath}`);
  console.log(`   Criteria:  ${criteria}`);
  console.log();
}

/**
 * Prints payment requirements summary
 */
function printPaymentRequirements(
  paymentRequirements: PaymentRequirements[]
): void {
  console.log(`✅ Received ${paymentRequirements.length} payment options:\n`);
  paymentRequirements.forEach((req) => {
    const amount = formatPaymentAmount(req.maxAmountRequired, req.network);
    console.log(`   • ${req.network}: ${amount} USDC`);
  });
  console.log();
}

/**
 * Prints network analysis results
 */
function printNetworkAnalysis(result: RankingResult): void {
  console.log("📊 Network Analysis:");
  console.log("─".repeat(ANALYSIS_SEPARATOR_LENGTH));

  result.rankedOptions.forEach((ranked, idx) => {
    const rankLabel = idx === 0 ? "1st" : idx === 1 ? "2nd" : `${idx + 1}th`;
    const marker = idx === 0 ? "🏆" : "  ";

    console.log(`\n${marker} [${rankLabel}] ${ranked.option.network}`);
    console.log(`   Fee:        ${ranked.estimate.feeUsdc.toFixed(6)} USDC`);
    console.log(
      `   Native:     ${ranked.estimate.feeNative} ${ranked.estimate.nativeSymbol}`
    );
    console.log(
      `   Soft Finality: ${formatMs(ranked.estimate.softFinalityMs)}`
    );
    console.log(
      `   Hard Finality: ${formatMs(ranked.estimate.hardFinalityMs)}`
    );
    console.log(
      `   Health:     ${
        ranked.estimate.isHealthy ? "🟢 Healthy" : "🔴 Unhealthy"
      } (${ranked.estimate.latencyMs}ms)`
    );
    console.log(`   Score:      ${ranked.score.toFixed(6)}`);
  });

  console.log("\n" + "─".repeat(ANALYSIS_SEPARATOR_LENGTH));
  console.log(`\n🏆 Selected: ${result.best.network}`);
  console.log(`   Reason: ${result.reason}`);

  if (result.unhealthyNetworks?.length) {
    console.log(
      `\n⚠️  Skipped unhealthy networks: ${result.unhealthyNetworks.join(", ")}`
    );
  }
}

/**
 * Prints payment success information
 */
function printPaymentSuccess(
  responseData: unknown,
  paymentResponseHeader?: string
): void {
  console.log("\n✅ Payment successful!");

  if (paymentResponseHeader) {
    const paymentResponse = decodeXPaymentResponse(paymentResponseHeader);
    console.log("\n💰 Payment Response:");
    console.log(JSON.stringify(paymentResponse, null, 2));
  }

  console.log("\n📦 Resource Data:");
  console.log(JSON.stringify(responseData, null, 2));
}

/**
 * Gets the address from a signer
 */
async function getSignerAddress(
  network: SupportedNetwork
): Promise<string | null> {
  try {
    const signer = await createNetworkSigner(network);
    const signerAny = signer as any;

    if (network.startsWith("base")) {
      return signerAny.account?.address || null;
    }

    if (network.startsWith("stellar")) {
      return (
        signerAny.publicKey ||
        signerAny.address ||
        signerAny.account?.address ||
        null
      );
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Prints payment instructions for dry-run mode
 */
async function printPaymentInstructions(
  paymentRequirements: PaymentRequirements[],
  selectedNetwork: SupportedNetwork
): Promise<void> {
  const requirement = paymentRequirements.find(
    (req) => req.network === selectedNetwork
  );

  if (!requirement) {
    throw new Error(
      `Payment requirement not found for network: ${selectedNetwork}`
    );
  }

  const decimals = getNetworkDecimals(selectedNetwork);
  const amount = Number(requirement.maxAmountRequired) / 10 ** decimals;
  const assetAddress =
    typeof requirement.asset === "string"
      ? requirement.asset
      : (requirement.asset as any)?.address || "USDC";

  const fromAddress = await getSignerAddress(selectedNetwork);

  console.log("\n💳 Payment Instructions:");
  console.log("─".repeat(ANALYSIS_SEPARATOR_LENGTH));
  console.log(`   Network:    ${selectedNetwork}`);
  console.log(
    `   From:       ${
      fromAddress || "[not configured - set private key to see address]"
    }`
  );
  console.log(`   To:         ${requirement.payTo}`);
  console.log(`   Amount:     ${amount.toFixed(decimals)} ${assetAddress}`);
  console.log(`   Asset:      ${assetAddress}`);
  console.log(`   Description: ${requirement.description || "N/A"}`);
  console.log("─".repeat(ANALYSIS_SEPARATOR_LENGTH));
  console.log("\n⚠️  Dry-run mode: Payment not executed.\n");
}

// ============================================================================
// Payment Functions
// ============================================================================

/**
 * Fetches payment requirements from the server
 * @throws Error if server request fails (non-402 error)
 */
async function fetchPaymentRequirements(
  serverUrl: string,
  endpointPath: string
): Promise<PaymentRequirements[]> {
  try {
    const response = await axios.get(`${serverUrl}${endpointPath}`);
    console.log("✅ Resource already accessible (no payment required)");
    console.log(response.data);
    process.exit(0);
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 402) {
      return error.response.data.accepts;
    }
    throw error;
  }
}

/**
 * Converts PaymentRequirements to PaymentOption format
 */
function convertToPaymentOptions(
  paymentRequirements: PaymentRequirements[]
): PaymentOption[] {
  return paymentRequirements.map((req) => ({
    network: req.network as SupportedNetwork,
    amount: req.maxAmountRequired || "0",
    asset: typeof req.asset === "string" ? req.asset : "USDC",
    payTo: req.payTo,
    description: req.description,
  }));
}

/**
 * Creates a signer for the given network
 * @throws Error if private key is not configured for the network
 */
async function createNetworkSigner(
  network: SupportedNetwork
): Promise<Awaited<ReturnType<typeof createSigner>>> {
  if (network.startsWith("base")) {
    if (!EVM_PRIVATE_KEY) {
      throw new Error(`EVM_PRIVATE_KEY not set. Cannot pay on ${network}.`);
    }
    console.log(`   Using EVM signer for ${network}`);
    return await createSigner(network, EVM_PRIVATE_KEY);
  }

  if (network.startsWith("stellar")) {
    if (!STELLAR_PRIVATE_KEY) {
      throw new Error(`STELLAR_PRIVATE_KEY not set. Cannot pay on ${network}.`);
    }
    console.log(`   Using Stellar signer for ${network}`);
    return await createSigner(network, STELLAR_PRIVATE_KEY);
  }

  throw new Error(`Unsupported network: ${network}`);
}

/**
 * Creates a payment requirements selector that chooses the specified network
 */
function createNetworkSelector(
  network: SupportedNetwork
): PaymentRequirementsSelector {
  return (accepts) => {
    const selected = accepts.find((a) => a.network === network);
    if (!selected) {
      throw new Error(`Network ${network} not found in accepts`);
    }
    return selected;
  };
}

/**
 * Extracts error details from an error object
 */
function extractErrorDetails(error: unknown): ErrorDetails {
  if (!(error instanceof AxiosError)) {
    return {
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // Check for payment response header with error details
  const paymentResponseHeader = error.response?.headers?.["x-payment-response"];
  if (paymentResponseHeader) {
    try {
      const paymentResponse = decodeXPaymentResponse(
        paymentResponseHeader
      ) as SettleResponse;
      if (!paymentResponse.success && paymentResponse.errorReason) {
        return {
          message: `Payment settlement failed: ${paymentResponse.errorReason}`,
          details: error.message,
          isInsufficientFunds: isInsufficientFundsError(
            paymentResponse.errorReason + " " + error.message
          ),
        };
      }
    } catch {
      // Failed to decode, fall through to default handling
    }
  }

  // Check for 402 Payment Required responses
  if (error.response?.status === 402) {
    const errorData = error.response.data as {
      error?: string;
      accepts?: PaymentRequirements[];
      x402Version?: number;
    };
    if (errorData?.error) {
      return {
        message: `HTTP ${error.response.status}: ${errorData.error}`,
        details: error.message,
        isInsufficientFunds: isInsufficientFundsError(errorData.error),
      };
    }
  }

  // Check for server errors
  if (error.response?.status === 500) {
    const errorData = error.response.data as { error?: string };
    if (errorData?.error) {
      return {
        message: `HTTP ${error.response.status}: ${errorData.error}`,
        details: error.message,
      };
    }
  }

  // Default HTTP error handling
  const statusText = error.response?.status
    ? `HTTP ${error.response.status}: ${error.response.statusText}`
    : error.message;

  return {
    message: statusText,
    details: error.response?.data
      ? JSON.stringify(error.response.data)
      : undefined,
    isInsufficientFunds: isInsufficientFundsError(error.message),
  };
}

/**
 * Validates that settlement was successful
 */
function validateSettlement(
  paymentResponseHeader: string | undefined,
  statusCode: number
): void {
  if (!paymentResponseHeader) {
    if (statusCode >= 400) {
      throw new Error(`Unexpected error: HTTP ${statusCode}`);
    }
    return;
  }

  try {
    const paymentResponse = decodeXPaymentResponse(
      paymentResponseHeader
    ) as SettleResponse;
    if (!paymentResponse.success) {
      throw new Error(
        `Payment settlement failed: ${
          paymentResponse.errorReason || "Unknown error"
        }`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("settlement failed")) {
      throw error;
    }
    // Otherwise, assume success (header might be in a different format)
  }
}

/**
 * Executes payment on the selected network
 */
async function executePayment(
  serverUrl: string,
  endpointPath: string,
  network: SupportedNetwork
): Promise<void> {
  const signer = await createNetworkSigner(network);
  const selector = createNetworkSelector(network);

  const api = withPaymentInterceptor(
    axios.create({ baseURL: serverUrl }),
    signer,
    selector
  );

  console.log(`\n🚀 Executing payment on ${network}...`);

  try {
    const response = await api.get(endpointPath);

    // Check for 402 response (settlement failed after payment header was created)
    if (response.status === 402) {
      const errorData = response.data as {
        error?: string;
        accepts?: PaymentRequirements[];
        x402Version?: number;
      };
      throw new Error(
        errorData?.error ||
          "Payment settlement failed after payment header was created"
      );
    }

    const paymentResponseHeader = response.headers["x-payment-response"];
    validateSettlement(paymentResponseHeader, response.status);
    printPaymentSuccess(response.data, paymentResponseHeader);
  } catch (error) {
    const errorDetails = extractErrorDetails(error);
    throw new Error(errorDetails.message);
  }
}

// ============================================================================
// Main Function
// ============================================================================

async function main(): Promise<void> {
  program.parse();

  const options = program.opts();
  const criteria = validateCriteria(options.criteria);
  const serverUrl = options.server;
  const endpointPath = options.endpoint;
  const isDryRun = options.dryRun as boolean;

  printHeader();
  printConfiguration(serverUrl, endpointPath, criteria);

  // Step 1: Fetch payment requirements
  console.log("📡 Fetching payment requirements from server...");
  const paymentRequirements = await fetchPaymentRequirements(
    serverUrl,
    endpointPath
  );
  printPaymentRequirements(paymentRequirements);

  // Step 2: Analyze and rank networks
  console.log(`🔍 Analyzing networks (criteria: ${criteria})...\n`);
  const paymentOptions = convertToPaymentOptions(paymentRequirements);
  const result = await rankPaymentOptions(paymentOptions, criteria);
  printNetworkAnalysis(result);

  // Step 3: Execute payment or show instructions
  if (isDryRun) {
    await printPaymentInstructions(paymentRequirements, result.best.network);
    return;
  }

  console.log("\n💳 Preparing payment...");

  if (!canExecutePayment()) {
    console.log(
      "\n⚠️  No private keys configured. Set EVM_PRIVATE_KEY and/or STELLAR_PRIVATE_KEY to execute payment."
    );
    console.log("   Demo complete (dry run).\n");
    return;
  }

  try {
    await executePayment(serverUrl, endpointPath, result.best.network);
  } catch (error) {
    const errorDetails = extractErrorDetails(error);

    console.error("\n❌ Payment failed:");
    console.error(`   ${errorDetails.message}`);

    if (errorDetails.details) {
      console.error(`\n   Details: ${errorDetails.details}`);
    }

    if (errorDetails.isInsufficientFunds) {
      console.error(
        "\n💡 This error typically means:",
        "\n   • Your account doesn't have enough native token (ETH for EVM, XLM for Stellar) for gas fees",
        "\n   • OR your account doesn't have enough USDC balance/allowance",
        "\n   • Make sure your account is funded before attempting payment"
      );
    }

    console.error();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
