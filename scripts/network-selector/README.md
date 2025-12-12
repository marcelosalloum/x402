# x402 Network Selector

**Network selection and cost/finality estimation for x402 Economic Load Balancer.**

Provides unified cost and finality estimation across EVM and Stellar networks, with intelligent caching, health checking, and payment ranking capabilities.

## Features

- **NetworkAnalysis**: Unified cost and finality estimation with 60s TTL caching
- **PaymentRanker**: Ranks x402 payment options by `lowest-cost` or `fastest-finality`
- **Health Checking**: Automatically skips unhealthy networks
- **Sponsored Payments**: Mark networks as sponsored (0 USDC fee)
- **Multi-Network**: Compare any number of networks in any order
- **Extensible**: Designed for adding Solana, Polygon, etc.

## Setup

```bash
cd scripts/network-selector
pnpm install
```

## Quick Start

### CLI Commands

```bash
# Run the full demo
pnpm demo

# Individual demos
pnpm demo:analysis     # NetworkAnalysis demo
pnpm demo:health       # Health check demo
pnpm demo:ranker       # PaymentRanker demo
pnpm demo:sponsored    # Sponsored payments demo
```

### Using the SDK

```typescript
import { NetworkAnalysis, PaymentRanker } from "./index.js";

// 1. Get network estimates
const analysis = new NetworkAnalysis({ cacheTtlMs: 60_000 });
const estimate = await analysis.getNetworkEstimate("base-sepolia");
console.log(`Cost: ${estimate.cost.feeUsdc} USDC`);
console.log(`Finality: ${estimate.finality.softFinalityMs}ms`);

// 2. Check network health
const health = await analysis.checkHealth("base-sepolia");
console.log(`Status: ${health.status}`);  // "healthy" | "degraded" | "unhealthy"

// 3. Rank payment options (unhealthy networks are skipped)
const ranker = new PaymentRanker();
const result = await ranker.rank(paymentRequirements, "lowest-cost");
console.log(`Best: ${result.best.network} - ${result.reason}`);
```

## API Reference

### NetworkAnalysis

```typescript
import { NetworkAnalysis } from "./index.js";

const analysis = new NetworkAnalysis({
  cacheTtlMs: 60_000,           // Cache TTL (default: 60s)
  enableCaching: true,          // Enable caching (default: true)
  healthCheckEnabled: true,     // Enable health checks (default: true)
  healthCheckTimeoutMs: 5_000,  // Health check timeout (default: 5s)
});

// Check network health
const health = await analysis.checkHealth("base-sepolia");
// { status: "healthy", latencyMs: 150, lastChecked: 1702400000000 }

// Get only healthy networks
const healthy = await analysis.getHealthyNetworks(["base", "stellar-testnet"]);

// Get combined cost + finality estimate
const estimate = await analysis.getNetworkEstimate("base-sepolia");
// {
//   cost: { feeUsdc: "0.000319", feeNative: "0.0000001...", ... },
//   finality: { softFinalityMs: 2000, hardFinalityMs: 900000, ... }
// }

// Get multiple estimates (skips unhealthy networks by default)
const estimates = await analysis.getMultipleEstimates(
  ["base-sepolia", "stellar-testnet"],
  ["stellar-testnet"],           // sponsored networks
  { skipUnhealthy: true }        // skip unhealthy (default: true)
);

// Cache management
analysis.invalidateCache("base-sepolia");  // Invalidate specific network
analysis.invalidateCache();                 // Invalidate all
```

### PaymentRanker

```typescript
import { PaymentRanker, type PaymentRequirement } from "./index.js";

const requirements: PaymentRequirement[] = [
  { network: "base-sepolia", amount: "1000000", asset: "USDC", payTo: "0x..." },
  { network: "stellar-testnet", amount: "1000000", asset: "USDC", payTo: "G..." },
];

const ranker = new PaymentRanker({
  cacheTtlMs: 60_000,
  sponsoredNetworks: ["stellar-testnet"],  // Mark as sponsored
  skipUnhealthy: true,                     // Skip unhealthy networks (default)
});

// Rank by lowest cost (unhealthy networks are skipped)
const result = await ranker.rank(requirements, "lowest-cost");
console.log(result.best.network);          // Best healthy network
console.log(result.reason);                // Explanation
console.log(result.unhealthyNetworks);     // Networks that were skipped

// Rank by fastest finality
const fast = await ranker.rank(requirements, "fastest-finality");

// Check network health
const health = await ranker.checkNetworkHealth("base-sepolia");

// Convenience methods
const best = await ranker.getBest(requirements, "lowest-cost");
const costResult = await ranker.rankLowestCost(requirements);
const finalityResult = await ranker.rankFastestFinality(requirements);

// Dynamic sponsorship
ranker.setSponsored("base-sepolia", true);
```

## CLI Commands

### Cost Comparison

Compare costs across **any number** of networks (order doesn't matter):

```bash
pnpm compare                                  # base-sepolia vs stellar-testnet
pnpm compare base stellar-mainnet             # base vs stellar-mainnet
pnpm compare stellar base base-sepolia        # 3-way comparison (any order)
pnpm compare base --sponsored=base            # Mark base as sponsored
pnpm compare base stellar --stellar-sponsored # Mark all Stellar as sponsored
pnpm compare --no-skip-unhealthy              # Include unhealthy networks
pnpm compare --list                           # List all networks
```

### Finality Comparison

Compare finality times across **any number** of networks:

```bash
pnpm compare:finality                         # base-sepolia vs stellar-testnet (soft)
pnpm compare:finality base stellar-mainnet    # base vs stellar-mainnet
pnpm compare:finality stellar base base-sepolia  # 3-way comparison
pnpm compare:finality --type=hard             # Hard finality comparison
pnpm compare:soft-finality                    # Soft finality (alias)
pnpm compare:hard-finality                    # Hard finality (alias)
```

### Individual Network Estimation

```bash
# EVM gas estimation
pnpm evm                        # Default: base-sepolia
pnpm evm base                   # Base mainnet
pnpm evm base --sponsored       # Sponsored (cost = 0)
pnpm evm --list                 # List all EVM networks

# Stellar fee estimation
pnpm stellar testnet            # Stellar testnet
pnpm stellar mainnet            # Stellar mainnet
pnpm stellar --sponsored        # Sponsored (cost = 0)
pnpm stellar --list             # List Stellar networks

# Finality estimation
pnpm evm-finality               # EVM finality times
pnpm stellar-finality           # Stellar finality times
```

## Health Checking

Networks are automatically checked for health before estimation. Unhealthy networks are skipped.

```typescript
const analysis = new NetworkAnalysis({ healthCheckEnabled: true });

// Health status values:
// - "healthy":   Network responding normally (< 2s latency)
// - "degraded":  Network slow but responding (>= 2s latency)
// - "unhealthy": Network not responding or erroring
// - "unknown":   Not yet checked

const health = await analysis.checkHealth("base-sepolia");
// {
//   network: "base-sepolia",
//   status: "healthy",
//   latencyMs: 150,
//   lastChecked: 1702400000000,
//   error: undefined
// }
```

## Example Output

### Multi-Network Cost Comparison

```
╔══════════════════════════════════════════════════════════════╗
║       x402 Economic Load Balancer - Cost Comparison          ║
╚══════════════════════════════════════════════════════════════╝

⛽ base-sepolia (EVM)
────────────────────────────────────────
   Fee:          0.000320 USDC
   Sponsored:    No
   Simulated:    Yes

⛽ base (EVM)
────────────────────────────────────────
   Fee:          0.000325 USDC
   Sponsored:    No
   Simulated:    Yes

⭐ stellar-testnet (STELLAR)
────────────────────────────────────────
   Fee:          0.002185 USDC
   Sponsored:    No
   Simulated:    Yes

🏆 Recommendation
────────────────────────────────────────
   Best Option:  ⛽ base-sepolia
   Reason:       1.0x cheaper than base (0.000320 vs 0.000325 USDC)
```

### Health Check Demo

```
╔══════════════════════════════════════════════════════════════╗
║       x402 Economic Load Balancer - Health Check Demo        ║
╚══════════════════════════════════════════════════════════════╝

🏥 Checking network health...

🟢 base-sepolia
   Status:   healthy
   Latency:  150ms

🟢 stellar-testnet
   Status:   healthy
   Latency:  280ms

✅ Healthy networks: base, base-sepolia, stellar-testnet, stellar-mainnet
```

## Supported Networks

| Network | Aliases | Type | Features |
|---------|---------|------|----------|
| `base` | - | EVM L2 | USDC, EIP-3009 |
| `base-sepolia` | - | EVM L2 Testnet | USDC, EIP-3009 |
| `stellar-testnet` | `stellar`, `testnet` | Stellar Testnet | SEP-41, Soroban |
| `stellar-mainnet` | `mainnet` | Stellar Mainnet | SEP-41, Soroban |

## Finality Types

| Finality Type | EVM (Base/L2) | Stellar |
|--------------|---------------|---------|
| **Soft** (Sequencer) | ~2s (L2 block) | ~5s (1 ledger) |
| **Hard** (L1 Settlement) | ~15m (rollup finality) | ~5s (SCP finality) |

## Architecture

```
network-selector/
├── index.ts              # Module exports
├── types.ts              # Core types (incl. health)
├── cache.ts              # TTL cache implementation
├── network-analysis.ts   # NetworkAnalysis class (+ health)
├── payment-ranker.ts     # PaymentRanker class
├── evm-gas.ts            # EVM cost estimation
├── evm-finality.ts       # EVM finality measurement
├── stellar-gas.ts        # Stellar cost estimation
├── stellar-finality.ts   # Stellar finality measurement
├── compare-costs.ts      # Multi-network cost CLI
├── compare-finality.ts   # Multi-network finality CLI
├── demo.ts               # Demo script
└── utils.ts              # Shared utilities
```

## Price Data

Live prices fetched from Coinbase API:
- ETH: `https://api.coinbase.com/v2/prices/ETH-USD/spot`
- XLM: `https://api.coinbase.com/v2/prices/XLM-USD/spot`

Fallback prices used if API fails: ETH=$3200, XLM=$0.24
