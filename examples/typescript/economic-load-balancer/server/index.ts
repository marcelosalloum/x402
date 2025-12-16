#!/usr/bin/env npx tsx
/**
 * Multi-Network Resource Server for x402 Economic Load Balancer Demo
 * 
 * This server demonstrates x402 payment middleware with support for multiple networks,
 * including response buffering to ensure resources are only released after on-chain settlement.
 */

import { config } from "dotenv";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { getAddress } from "viem";
import { exact } from "x402/schemes";
import {
  processPriceToAtomicAmount,
  findMatchingPaymentRequirements,
  toJsonSafe,
} from "x402/shared";
import {
  type PaymentRequirements,
  type Network,
  type PaymentPayload,
  type Resource,
  SupportedEVMNetworks,
  SupportedStellarNetworks,
  ERC20TokenAmount,
  settleResponseHeader,
  PaymentMiddlewareConfig,
} from "x402/types";
import { useFacilitator } from "x402/verify";

config();

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.PORT || 4021;
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";
const X402_VERSION = 1;
const DEFAULT_TIMEOUT_SECONDS = 60;

const PAY_TO_ADDRESSES: Partial<Record<Network, string>> = {};
if (process.env.BASE_SEPOLIA_ADDRESS) {
  PAY_TO_ADDRESSES["base-sepolia"] = process.env.BASE_SEPOLIA_ADDRESS;
}
if (process.env.STELLAR_ADDRESS) {
  PAY_TO_ADDRESSES["stellar-testnet"] = process.env.STELLAR_ADDRESS;
}

const SUPPORTED_NETWORKS = Object.keys(PAY_TO_ADDRESSES) as Network[];
const { verify, settle, supported } = useFacilitator({
  url: FACILITATOR_URL as Resource,
});

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Constructs the full resource URL from the incoming request
 */
function getResourceUrl(req: Request): string {
  const host = req.get("host") || `localhost:${PORT}`;
  return `${req.protocol}://${host}${req.path}`;
}

/**
 * Checks if an error is related to facilitator connectivity issues
 */
function isFacilitatorError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const msg = error.message.toLowerCase();
  const hasConnectionError = 
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("could not reach");
    
  if (hasConnectionError) return true;

  const hasErrorCode = (e: any): boolean =>
    e?.code === "ECONNREFUSED" || e?.code === "ENOTFOUND";

  const err = error as any;
  return (
    hasErrorCode(err) ||
    hasErrorCode(err.cause) ||
    (Array.isArray(err.errors) && err.errors.some(hasErrorCode)) ||
    (Array.isArray(err.cause?.errors) && err.cause.errors.some(hasErrorCode))
  );
}

/**
 * Extracts standardized error message from an error object
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ============================================================================
// Payment Requirements Generation
// ============================================================================

/**
 * Builds payment requirements for a specific network
 */
async function buildPaymentRequirementForNetwork(
  network: Network,
  payTo: string,
  price: number | string,
  resourceUrl: Resource,
  method: string,
  config: PaymentMiddlewareConfig = {}
): Promise<PaymentRequirements> {
  const atomicAmountResult = processPriceToAtomicAmount(price, network);
  if ("error" in atomicAmountResult) {
    throw new Error(atomicAmountResult.error);
  }

  const { maxAmountRequired, asset } = atomicAmountResult;
  const {
    description = "",
    mimeType = "",
    maxTimeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    inputSchema,
    outputSchema,
    discoverable = true,
  } = config;

  if (SupportedEVMNetworks.includes(network)) {
    return {
      scheme: "exact",
      network,
      maxAmountRequired,
      resource: resourceUrl,
      description,
      mimeType,
      payTo: getAddress(payTo),
      maxTimeoutSeconds,
      asset: getAddress(asset.address),
      outputSchema: {
        input: {
          type: "http",
          method,
          discoverable,
          ...inputSchema,
        },
        output: outputSchema,
      },
      extra: (asset as ERC20TokenAmount["asset"]).eip712,
    };
  }

  if (SupportedStellarNetworks.includes(network)) {
    return await exact.stellar.buildExactStellarPaymentRequirements(
      payTo,
      maxAmountRequired,
      asset,
      network,
      config,
      resourceUrl,
      method,
      supported
    );
  }

  throw new Error(`Unsupported network: ${network}`);
}

/**
 * Generates payment requirements for all configured networks
 */
async function generatePaymentRequirements(
  priceUsd: number,
  resourceUrl: string,
  method: string,
  config: PaymentMiddlewareConfig = {}
): Promise<PaymentRequirements[]> {
  const requirements: PaymentRequirements[] = [];

  for (const network of SUPPORTED_NETWORKS) {
    const payTo = PAY_TO_ADDRESSES[network];
    if (!payTo) continue;

    try {
      const requirement = await buildPaymentRequirementForNetwork(
        network,
        payTo,
        priceUsd,
        resourceUrl as Resource,
        method,
        config
      );
      requirements.push(requirement);
    } catch (error) {
      if (isFacilitatorError(error)) {
        throw new Error(`Could not reach facilitator at endpoint ${FACILITATOR_URL}`);
      }
      console.warn(
        `Failed to build payment requirement for ${network}:`,
        getErrorMessage(error)
      );
    }
  }

  return requirements;
}

// ============================================================================
// Response Buffering
// ============================================================================

type BufferedCall =
  | ["writeHead", Parameters<typeof Response.prototype.writeHead>]
  | ["write", Parameters<typeof Response.prototype.write>]
  | ["end", Parameters<typeof Response.prototype.end>]
  | ["flushHeaders", []];

interface ResponseBuffer {
  calls: BufferedCall[];
  isSettled: boolean;
  originals: {
    writeHead: typeof Response.prototype.writeHead;
    write: typeof Response.prototype.write;
    end: typeof Response.prototype.end;
    flushHeaders: () => void;
  };
  endPromise: Promise<void>;
  endResolve: () => void;
}

/**
 * Creates a response buffer that intercepts and buffers all response calls
 * until settlement completes
 */
function createResponseBuffer(res: Response): ResponseBuffer {
  const calls: BufferedCall[] = [];
  let isSettled = false;
  let endResolve: () => void;
  
  const endPromise = new Promise<void>((resolve) => {
    endResolve = resolve;
  });

  const originals = {
    writeHead: res.writeHead.bind(res),
    write: res.write.bind(res),
    end: res.end.bind(res),
    flushHeaders: res.flushHeaders?.bind(res) || (() => {}),
  };

  return { calls, isSettled, originals, endPromise, endResolve: endResolve! };
}

/**
 * Installs buffering interceptors on the response object
 */
function installBuffering(res: Response, buffer: ResponseBuffer): void {
  res.writeHead = function (...args: Parameters<typeof buffer.originals.writeHead>) {
    if (!buffer.isSettled) {
      buffer.calls.push(["writeHead", args as any]);
      return res;
    }
    return buffer.originals.writeHead(...args);
  } as typeof res.writeHead;

  res.write = function (...args: Parameters<typeof buffer.originals.write>) {
    if (!buffer.isSettled) {
      buffer.calls.push(["write", args as any]);
      return true;
    }
    return buffer.originals.write(...args);
  } as typeof res.write;

  res.end = function (...args: Parameters<typeof buffer.originals.end>) {
    if (!buffer.isSettled) {
      buffer.calls.push(["end", args as any]);
      buffer.endResolve();
      return res;
    }
    return buffer.originals.end(...args);
  } as typeof res.end;

  res.flushHeaders = () =>
    !buffer.isSettled
      ? buffer.calls.push(["flushHeaders", []])
      : buffer.originals.flushHeaders();
}

/**
 * Replays all buffered response calls
 */
function replayBufferedCalls(buffer: ResponseBuffer): void {
  for (const [method, args] of buffer.calls) {
    if (method === "writeHead") (buffer.originals.writeHead as any)(...args);
    else if (method === "write") (buffer.originals.write as any)(...args);
    else if (method === "end") (buffer.originals.end as any)(...args);
    else if (method === "flushHeaders") buffer.originals.flushHeaders();
  }
  buffer.calls.length = 0;
}

/**
 * Restores original response methods
 */
function restoreResponse(res: Response, buffer: ResponseBuffer): void {
  buffer.isSettled = true;
  Object.assign(res, buffer.originals);
}

// ============================================================================
// Payment Middleware
// ============================================================================

/**
 * Creates Express middleware that requires x402 payment before serving resources
 * Buffers responses until on-chain settlement is confirmed
 */
function multiNetworkPaymentMiddleware(
  priceUsd: number,
  config: PaymentMiddlewareConfig = {}
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const paymentHeader = req.headers["x-payment"];
    const resourceUrl = getResourceUrl(req);
    const method = req.method.toUpperCase();

    // Helper to get payment requirements with error handling
    const getRequirements = async (): Promise<PaymentRequirements[]> => {
      try {
        return await generatePaymentRequirements(priceUsd, resourceUrl, method, config);
      } catch (error) {
        if (error instanceof Error && error.message.includes("Could not reach facilitator")) {
          res.status(500).json({ error: error.message });
          throw error;
        }
        throw error;
      }
    };

    // Helper to send 402 Payment Required response
    const send402 = (paymentRequirements: PaymentRequirements[], error?: string) => {
      res.status(402).json({
        x402Version: X402_VERSION,
        accepts: toJsonSafe(paymentRequirements),
        error: error || "Payment required",
        facilitatorUrl: FACILITATOR_URL,
      });
    };

    // No payment header - request payment requirements
    if (!paymentHeader) {
      try {
        send402(await getRequirements());
      } catch {
        // Error already handled in getRequirements
      }
      return;
    }

    // Decode and validate payment header
    let decodedPayment: PaymentPayload;
    try {
      const headerValue = Array.isArray(paymentHeader) ? paymentHeader[0] : paymentHeader;
      decodedPayment = exact.evm.decodePayment(headerValue);
      decodedPayment.x402Version = X402_VERSION;
    } catch (error) {
      try {
        const errorMsg = error instanceof Error 
          ? error.message 
          : "Invalid or malformed payment header";
        send402(await getRequirements(), errorMsg);
      } catch {
        // Error already handled in getRequirements
      }
      return;
    }

    // Get payment requirements
    let paymentRequirements: PaymentRequirements[];
    try {
      paymentRequirements = await getRequirements();
    } catch {
      return;
    }

    // Match payment to requirements
    const selectedPaymentRequirements = findMatchingPaymentRequirements(
      paymentRequirements,
      decodedPayment
    );
    
    if (!selectedPaymentRequirements) {
      return send402(paymentRequirements, "Unable to find matching payment requirements");
    }

    // Verify payment signature
    try {
      const verifyResponse = await verify(decodedPayment, selectedPaymentRequirements);
      if (!verifyResponse.isValid) {
        return send402(paymentRequirements, verifyResponse.invalidReason);
      }
    } catch (error) {
      return send402(
        paymentRequirements,
        getErrorMessage(error) || "Payment verification failed"
      );
    }

    // Set up response buffering
    const buffer = createResponseBuffer(res);
    installBuffering(res, buffer);

    // Execute the route handler
    next();
    
    // Wait for handler to complete
    await buffer.endPromise;

    // If error response, replay immediately without settlement
    if (res.statusCode >= 400) {
      restoreResponse(res, buffer);
      replayBufferedCalls(buffer);
      return;
    }

    // Settle payment on-chain
    try {
      const settleResponse = await settle(decodedPayment, selectedPaymentRequirements);
      
      if (!settleResponse.success) {
        buffer.calls.length = 0; // Clear buffered response
        return send402(
          paymentRequirements,
          settleResponse.errorReason || "Payment settlement failed"
        );
      }

      res.setHeader("X-PAYMENT-RESPONSE", settleResponseHeader(settleResponse));
    } catch (error) {
      buffer.calls.length = 0; // Clear buffered response
      return send402(
        paymentRequirements,
        getErrorMessage(error) || "Payment settlement failed"
      );
    } finally {
      restoreResponse(res, buffer);
      replayBufferedCalls(buffer);
    }
  };
}

// ============================================================================
// Routes
// ============================================================================

app.get("/health", (req, res) =>
  res.json({ status: "ok", networks: SUPPORTED_NETWORKS })
);

app.get(
  "/premium/agent-insight",
  multiNetworkPaymentMiddleware(0.001, {
    description: "Premium Agent Insight - AI-powered market analysis",
    mimeType: "application/json",
  }),
  (req: Request, res: Response) => {
    res.json({
      insight: {
        title: "Premium Agent Insight",
        timestamp: new Date().toISOString(),
        analysis: {
          market: "Crypto",
          sentiment: "Bullish",
          confidence: 0.87,
          signals: [
            { indicator: "RSI", value: 65, interpretation: "Neutral-Bullish" },
            { indicator: "MACD", value: "Positive crossover", interpretation: "Bullish" },
            { indicator: "Volume", value: "Above average", interpretation: "Strong" },
          ],
        },
        recommendation: "Consider accumulating during dips",
        disclaimer: "This is simulated data for demo purposes only.",
      },
    });
  }
);

app.get(
  "/weather",
  multiNetworkPaymentMiddleware(0.0001, {
    description: "Weather data",
    mimeType: "application/json",
  }),
  (req: Request, res: Response) => {
    res.json({
      report: {
        weather: "sunny",
        temperature: 72,
        humidity: 45,
        location: "San Francisco, CA",
      },
    });
  }
);

app.get("/networks", (req, res) =>
  res.json({
    networks: SUPPORTED_NETWORKS,
    addresses: PAY_TO_ADDRESSES,
    facilitatorUrl: FACILITATOR_URL,
  })
);

// ============================================================================
// Server Startup
// ============================================================================

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     x402 Economic Load Balancer - Multi-Network Server       ║
╚══════════════════════════════════════════════════════════════╝

🌐 Server listening at http://localhost:${PORT}

📋 Endpoints:
   GET /health                - Health check
   GET /networks              - List supported networks
   GET /premium/agent-insight - Premium content ($0.001 USDC)
   GET /weather               - Weather data ($0.0001 USDC)

💳 Accepted Networks:
   Base Sepolia: ${PAY_TO_ADDRESSES["base-sepolia"] || "Not configured"}
   Stellar Testnet: ${PAY_TO_ADDRESSES["stellar-testnet"] || "Not configured"}

🔗 Facilitator: ${FACILITATOR_URL}
`);
});
