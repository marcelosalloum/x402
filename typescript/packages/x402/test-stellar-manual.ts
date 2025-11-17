/**
 * Manual test for Stellar x402 implementation
 *
 * HOW TO RUN:
 * -----------
 * From the x402 monorepo root:
 *   npx tsx typescript/packages/x402/test-stellar-manual.ts
 *
 * Or from typescript/packages/x402 directory:
 *   npx tsx test-stellar-manual.ts
 *
 * PREREQUISITES:
 * --------------
 * - The test accounts must have XLM funded on Stellar testnet
 * - Use Stellar Laboratory (https://laboratory.stellar.org/#account-creator)
 *   to create and fund test accounts if needed
 *
 * WHAT THIS TESTS:
 * ----------------
 * 1. Client creates and signs payment using x402
 * 2. Facilitator verifies the payment
 * 3. Facilitator settles payment on-chain
 *
 * This ensures the complete Stellar x402 flow is working correctly.
 */

// Import from the source (not built package)
import { getRpcClient } from "./src/shared/stellar/rpc";
import { createAndSignPayment } from "./src/schemes/exact/stellar/client";
import { createStellarSigner } from "./src/shared/stellar/signer";
import { verify } from "./src/schemes/exact/stellar/facilitator/verify";
import { settle } from "./src/schemes/exact/stellar/facilitator/settle";
import type { PaymentRequirements } from "./src/types/verify";

/**
 * Tests the complete Stellar x402 flow
 *
 * @returns void
 */
async function testStellarPayment() {
  console.log("🚀 Starting Stellar x402 Manual Test\n");

  // Test accounts
  const CLIENT_SECRET = "SDV3OZOPGIO6GQAVI7T6ZJ7NSNFB26JX6QZYCI64TBC7BAZY6FQVAXXK";
  const CLIENT_PUBLIC = "GBBO4ZDDZTSM2IUKQYBAST3CFHNPFXECGEFTGWTA2WELR2BIWDK57UVE";
  const SERVER_SECRET = "SAHN3BJWAPGYCRTZKUZGTVAIXCE57ULQ5SDEGSFNIKFZOXQQKG3LUHVA";
  const SERVER_PUBLIC = "GCHEI4PQEFJOA27MNZRPQNLGURS6KASW76X5UZCUZIXCOJLKXYCXOR2W";
  const XLM_TOKEN_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

  console.log("📋 Test Configuration:");
  console.log(`   Client:  ${CLIENT_PUBLIC}`);
  console.log(`   Server:  ${SERVER_PUBLIC}`);
  console.log(`   Asset:   ${XLM_TOKEN_CONTRACT}`);
  console.log(`   Network: stellar-testnet`);
  console.log(`   Amount:  1000000 stroops (0.1 XLM)\n`);

  // Step 1: Create payment requirements (what the server would send in 402 response)
  const paymentRequirements: PaymentRequirements = {
    scheme: "exact",
    network: "stellar-testnet",
    resource: "https://api.example.com/protected-resource",
    description: "Test x402 protected resource",
    mimeType: "application/json",
    maxTimeoutSeconds: 300,
    maxAmountRequired: "1000000", // 0.1 XLM in stroops
    payTo: SERVER_PUBLIC,
    asset: XLM_TOKEN_CONTRACT,
  };

  console.log("✅ Step 1: Payment requirements created");

  try {
    // Step 2: Client creates and signs payment
    console.log("\n🔐 Step 2: Creating client payment...");
    const clientSigner = createStellarSigner(CLIENT_SECRET, "stellar-testnet");

    const paymentPayload = await createAndSignPayment(
      clientSigner,
      1, // x402Version
      paymentRequirements,
    );

    console.log("✅ Payment payload created:");
    console.log(`   Scheme: ${paymentPayload.scheme}`);
    console.log(`   Network: ${paymentPayload.network}`);
    console.log(`   Transaction length: ${paymentPayload.payload.transaction.length} chars`);

    // Debug: show first 200 chars of transaction
    console.log(
      `   Transaction preview: ${paymentPayload.payload.transaction.substring(0, 200)}...`,
    );

    // Step 3: Facilitator verifies payment
    console.log("\n🔍 Step 3: Verifying payment...");
    const rpcClient = getRpcClient("stellar-testnet");

    const verifyResult = await verify(rpcClient, paymentPayload, paymentRequirements);

    if (!verifyResult.isValid) {
      console.error("❌ Verification failed:", verifyResult.invalidReason);
      process.exit(1);
    }

    console.log("✅ Payment verified successfully!");
    console.log(`   Payer: ${verifyResult.payer}`);

    // Step 4: Facilitator settles payment
    console.log("\n💰 Step 4: Settling payment on-chain...");
    console.log("   (This may take 30-60 seconds)");

    const serverSigner = createStellarSigner(SERVER_SECRET, "stellar-testnet");
    const settleResult = await settle(serverSigner, paymentPayload, paymentRequirements);

    if (!settleResult.success) {
      console.error("❌ Settlement failed:", settleResult.errorReason);
      console.error("   Transaction:", settleResult.transaction || "N/A");
      process.exit(1);
    }

    console.log("✅ Settlement successful!");
    console.log(`   Transaction hash: ${settleResult.transaction}`);
    console.log(`   Payer: ${settleResult.payer}`);
    console.log(`   Network: ${settleResult.network}`);
    console.log(`\n🔗 View on explorer:`);
    console.log(`   https://stellar.expert/explorer/testnet/tx/${settleResult.transaction}`);

    console.log("\n🎉 All tests passed! Stellar x402 implementation is working correctly.\n");
  } catch (error: any) {
    console.error("\n❌ Test failed with error:");
    console.error(error);
    if (error.response) {
      console.error("\nResponse data:", error.response.data);
    }
    process.exit(1);
  }
}

// Run the test
testStellarPayment().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
