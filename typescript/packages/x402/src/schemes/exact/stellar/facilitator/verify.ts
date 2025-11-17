import { rpc, scValToNative, Transaction, Address, Operation } from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";

import {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  ExactStellarPayloadSchema,
  ErrorReason,
} from "../../../../types/verify";
import { SupportedStellarNetworks } from "../../../../types";
import { getNetworkPassphrase } from "../../../../shared/stellar/rpc";
import { gatherAuthEntrySignatureStatus } from "../shared";

/**
 * Creates an invalid verification response
 *
 * @param reason - The error reason code
 * @param payer - Optional payer address
 * @returns Invalid verification response
 */
export function invalidResponse(reason: ErrorReason, payer?: string): VerifyResponse {
  return { isValid: false, invalidReason: reason, payer };
}

/**
 * Creates a valid verification response
 *
 * @param payer - The payer address
 * @returns Valid verification response
 */
export function validResponse(payer: string): VerifyResponse {
  return { isValid: true, payer };
}

/**
 * Verifies a Stellar payment payload against payment requirements.
 *
 * Verification steps:
 * 1. Validate protocol version and network
 * 2. Decode transaction from XDR
 * 3. Validate it's an invokeHostFunction operation calling transfer
 * 4. Validate contract address, recipient, and amount
 * 5. Re-simulate transaction to ensure it will succeed
 *
 * @param server - Soroban RPC server instance
 * @param payload - Payment payload from X-PAYMENT header
 * @param paymentRequirements - Original payment requirements
 * @returns VerifyResponse with validation result
 */
export async function verify(
  server: rpc.Server,
  payload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): Promise<VerifyResponse> {
  try {
    // 1. Validate protocol version, scheme, and network
    if (payload.x402Version !== 1) return invalidResponse("invalid_x402_version");
    if (payload.scheme !== "exact") return invalidResponse("invalid_scheme");
    if (
      payload.network !== paymentRequirements.network ||
      !SupportedStellarNetworks.includes(paymentRequirements.network)
    )
      return invalidResponse("invalid_network");

    // 2. Parse and decode transaction
    const stellarPayload = ExactStellarPayloadSchema.parse(payload.payload);
    const networkPassphrase = getNetworkPassphrase(paymentRequirements.network);

    let transaction: Transaction;
    try {
      transaction = new Transaction(stellarPayload.transaction, networkPassphrase);
    } catch (error) {
      console.error("Error parsing transaction:", error);
      return invalidResponse("invalid_exact_stellar_payload_malformed");
    }

    // 3. Validate transaction structure
    if (transaction.operations.length !== 1) {
      console.error("Invalid transaction operations length:", transaction.operations.length);
      return invalidResponse("invalid_exact_stellar_payload_wrong_operation");
    }

    const operation = transaction.operations[0];
    if (operation.type !== "invokeHostFunction") {
      return invalidResponse("invalid_exact_stellar_payload_wrong_operation");
    }

    // 4. Extract and validate contract invocation details
    const invokeOp = operation as Operation.InvokeHostFunction;
    const func = invokeOp.func;

    if (!func || func.switch().name !== "hostFunctionTypeInvokeContract") {
      return invalidResponse("invalid_exact_stellar_payload_wrong_operation");
    }

    const invokeContractArgs = func.invokeContract();
    const contractAddress = Address.fromScAddress(invokeContractArgs.contractAddress()).toString();
    const functionName = invokeContractArgs.functionName().toString();
    const args = invokeContractArgs.args();

    // 5. Validate contract address and function name
    if (contractAddress !== paymentRequirements.asset) {
      return invalidResponse("invalid_exact_stellar_payload_wrong_asset");
    }

    if (functionName !== "transfer" || args.length !== 3) {
      return invalidResponse("invalid_exact_stellar_payload_wrong_function_name");
    }

    if (args.length !== 3) {
      return invalidResponse("invalid_exact_stellar_payload_wrong_function_args");
    }

    // 6. Extract and validate transfer arguments
    const fromAddress = scValToNative(args[0]) as string;
    const toAddress = scValToNative(args[1]) as string;
    const amount = scValToNative(args[2]) as bigint;

    if (toAddress !== paymentRequirements.payTo) {
      return invalidResponse("invalid_exact_stellar_payload_wrong_recipient", fromAddress);
    }

    const requiredAmount = BigInt(paymentRequirements.maxAmountRequired);
    if (amount !== requiredAmount) {
      return invalidResponse("invalid_exact_stellar_payload_wrong_amount", fromAddress);
    }

    // 7. Re-simulate to ensure transaction will succeed
    const simulateResponse = await server.simulateTransaction(transaction);
    if (Api.isSimulationError(simulateResponse)) {
      console.error("Simulation error:", simulateResponse.error);
      return invalidResponse("invalid_exact_stellar_payload_simulation_failed", fromAddress);
    }

    // 8. Audit signers to ensure transaction is properly signed
    const authStatus = gatherAuthEntrySignatureStatus({
      transaction,
      simulationResponse: simulateResponse,
    });

    // Ensure the payer has already signed
    if (!authStatus.alreadySigned.includes(fromAddress)) {
      return invalidResponse("invalid_exact_stellar_payload_missing_payer_signature", fromAddress);
    }

    // Ensure no other signatures are pending
    if (authStatus.pendingSignature.length > 0) {
      console.error("Unexpected pending signatures:", authStatus.pendingSignature);
      return invalidResponse(
        "invalid_exact_stellar_payload_unexpected_pending_signatures",
        fromAddress,
      );
    }

    return validResponse(fromAddress);
  } catch (error) {
    console.error("Unexpected verification error:", error);
    return invalidResponse("unexpected_verify_error");
  }
}
