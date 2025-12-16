# HACKATHON_MASTER_PLAN.md
> **Status:** 🟢 Phase 2 Complete / Ready Phase 3
> **Goal:** Build the "Economic Load Balancer" for x402 (Stellar + EVM) and submit it to the x402 hackathon (https://www.x402hackathon.com/).
> **Repo Context:** `coinbase/x402` (upstream aka origin) vs `marcelosalloum/x402` (branches: `stellar-support`, `stellar-paywall-support`)

## 1. Product Vision
**"The x402 Economic Load Balancer"**
A middleware client that automatically routes agent payments to the most optimal network (Stellar vs Base) based on cost, speed, and finality.
- **Problem:** Agents shouldn't overpay for gas on high-frequency transactions.
- **Solution:** A smart x402 client that intercepts `402 Payment Required`, analyzes the `accepts` options, calculates real-time costs (including gas), and executes the best payment.

## 2. Technical Architecture
### Core Components
1.  **Smart Client (Axios-based):**
    - Interceptor for `402` errors.
    - Logic to parse `accepts: [paymentRequirements]`.
2.  **Gas/Cost Estimator Service:**
    - **Interface:** `getCost(network, rawAmount)`
    - **Caching:** Cache gas prices for 60s (configurable).
    - **Chain health checker**: if the chain is not healthy, it should not be considered for payment. It can be ckeched again after the (60s) timeout is over.
    - **Stellar Logic:** Check if `facilitator` sponsors fees (Cost = 0) OR fetch ledger stats.
    - **EVM Logic:** Fetch `gasPrice` + estimate gas limit for ERC-20 transfer.
3.  **Ranking Engine:**
    - Input: `[Options]`, `Criteria` (Price | Soft-Finality | Irrevocable-Finality)
    - Output: `SelectedOption`
4.  **Modularization**: the implementation should be modularized, so that it can be easily extended to support new networks, payment schemes, and criteria. Interfaces are highly recommended to achieve the goal of modularization.
5.  **Testing**: the parallel modules implementation should be tested, so that it can be sure that it is working as expected, especially when the responsibility of the module is easy to define, like gathering cost per chain.
6.  **Documentation**: the implementation should be documented, so that it can be easy to understand and use.
7.  **Performance**: the implementation should be performant, so that it can be used in a production environment.
8.  **Security**: the implementation should be secure, so that it can be used in a production environment.
9.  **Reliability**: the implementation should be reliable, so that it can be used in a production environment.
10.  **Scalability**: the implementation should be scalable, so that it can be used in a production environment.
11.  **Maintainability**: the implementation should be maintainable, so that it can be easy to maintain and update.

### Supported Networks (MVP)
1.  **Stellar Testnet:** High speed, low cost, immediate finality.
2.  **Base Sepolia:** EVM compatibility, soft finality.

## 3. Implementation Roadmap
- [x] **Phase 0: Recon & Alignment**: Compare forks, validate schemas, test gas estimation with PoC spikes
- [x] **Phase 1: The Core SDK**: NodeJS/TS implementation of the ranking logic (`NetworkAnalysis`, `PaymentRanker`)
- [x] **Phase 2: CLI Demo**: A script that requests a resource and logs the decision process with real-time network data
- [ ] **Phase 3: Web Dashboard**: React app visualizing the "Race" between chains with live gas feeds

## 4. Open Questions — ANSWERED ✅

### Q1: Does the current `x402-hackathon` branch fully implement the `accepts` schema provided?
> **Answer: ✅ YES**

The `x402-hackathon` branch includes full Stellar network support:

```typescript
// From x402-hackathon:typescript/packages/x402/src/types/shared/network.ts
export const NetworkSchema = z.enum([
  // ... EVM networks ...
  "stellar",
  "stellar-testnet",
]);

export const SupportedStellarNetworks: Network[] = ["stellar", "stellar-testnet"];
export const StellarNetworkToPassphrase = new Map<Network, string>([
  ["stellar", "Public Global Stellar Network ; September 2015"],
  ["stellar-testnet", "Test SDF Network ; September 2015"],
]);
```

**Verified Implementations:**
- `PaymentRequirementsSchema` supports `network: "stellar-testnet"` ✅
- Stellar token catalog with USDC addresses for both networks ✅
- Full client for signing Stellar payments (`createPaymentHeader`) ✅
- RPC helpers (`getRpcClient`, `getNetworkPassphrase`) ✅

---

### Q2: What is the best API to get Base Sepolia gas fees without an API key?
> **Answer: Use public RPCs via viem's `createPublicClient`**

Public RPC endpoints that work without API keys:
- `https://sepolia.base.org` (official)
- `https://base-sepolia.blockpi.network/v1/rpc/public`
- `https://1rpc.io/base-sepolia`

See **Section 6: Code Snippets** for the implementation.

---

### Q3: How do we simulate "gas price surges" to show the Load Balancer switching chains?
> **Answer: Mock the gas estimator with configurable multipliers**

Strategy:
1. Create a `GasEstimator` interface with a mock implementation
2. Use a `surgeFactor: number` parameter (e.g., `1.0` = normal, `10.0` = 10x surge)
3. In the demo, show live cost comparison with a slider to simulate surge conditions

```typescript
interface GasEstimator {
  getNetworkCost(network: Network, amount: bigint): Promise<CostEstimate>;
}

// Mock for demo
class MockGasEstimator implements GasEstimator {
  constructor(private surgeFactor: Record<Network, number> = {}) {}

  async getNetworkCost(network: Network, amount: bigint): Promise<CostEstimate> {
    const baseCost = await this.fetchRealCost(network, amount);
    const factor = this.surgeFactor[network] ?? 1.0;
    return { ...baseCost, totalCost: baseCost.totalCost * factor };
  }
}
```

---

## 5. HTTP Client Decision: Axios ✅

**Recommendation: Use `axios`**

Analysis of the codebase:

|     Pattern     | Files Using It |  Occurrences   |
|-----------------|----------------|----------------|
| `axios` imports | 19 files       | 35 occurrences |
| `fetch` wrapper | 5 files        | 8 occurrences  |

The `x402-axios` package is the primary client pattern. Most examples (cdp-sdk, mcp, dynamic-agent) use axios interceptors. The existing `withPaymentInterceptor` API is axios-based and well-tested.

---

## 6. Code Snippets — Gas/Cost Estimation (USDC)

> **All costs are normalized to USDC** for unified comparison across networks.

### 6.1 EVM (Base Sepolia) Gas Estimation

```typescript
import { getEvmFeeCost } from "./evm-gas.js";

// Simulates actual EIP-3009 transferWithAuthorization transactions
const estimate = await getEvmFeeCost("base-sepolia", false);
// {
//   network: "base-sepolia",
//   chainId: 84532,
//   nativeSymbol: "ETH",
//   nativeUsdPrice: 3230.55,        // Live price from Coinbase API
//   gasPriceGwei: "0.0012",
//   estimatedGasUnits: 86400n,     // Simulated from actual transaction
//   estimatedCostNative: "0.000000103700",
//   estimatedCostUsdc: "0.000335",
//   isSponsored: false,
//   isSimulated: true
// }
```

### 6.2 Stellar Fee Estimation

```typescript
import { getStellarFeeCost } from "./stellar-gas.js";

// Simulates actual Soroban token transfers using native XLM contract
const estimate = await getStellarFeeCost("stellar-testnet", false);
// {
//   network: "stellar-testnet",
//   tokenLabel: "native-xlm",
//   tokenContract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
//   xlmUsdPrice: 0.2455,            // Live price from Coinbase API
//   simulatedFeeStroops: 91722,
//   simulatedFeeXlm: "0.0091722",
//   simulatedFeeUsdc: "0.002251",
//   isSponsored: false,
//   isSimulated: true
// }
```

### 6.3 NetworkAnalysis (Cost + Finality Estimator)

```typescript
import { NetworkAnalysis } from "./network-analysis.js";

const analysis = new NetworkAnalysis({ cacheTtlMs: 60_000 });

// Get combined cost + finality estimate
const estimate = await analysis.getNetworkEstimate("base-sepolia");
// {
//   cost: { feeUsdc: "0.000319", feeNative: "0.0000001...", isSponsored: false, ... },
//   finality: { softFinalityMs: 2000, hardFinalityMs: 900000, ... }
// }

// Get multiple estimates in parallel
const estimates = await analysis.getMultipleEstimates(
  ["base-sepolia", "stellar-testnet"],
  ["stellar-testnet"]  // sponsored networks
);
```

### 6.4 PaymentRanker (Ranking Engine)

```typescript
import { rankPaymentOptions, type PaymentOption } from "./network-ranker.js";

const options: PaymentOption[] = [
  { network: "base-sepolia", amount: "1000000", asset: "USDC", payTo: "0x..." },
  { network: "stellar-testnet", amount: "1000000", asset: "USDC", payTo: "G..." },
];

// Rank by lowest cost
const result = await rankPaymentOptions(options, "lowest-cost");
console.log(result.best.network);   // "base-sepolia"
console.log(result.reason);         // "base-sepolia is 5.0x cheaper (0.000405 vs 0.002025 USDC)"

// Rank by fastest soft finality
const softResult = await rankPaymentOptions(options, "fastest-soft-finality");
console.log(softResult.best.network);  // "base-sepolia" (2.0s vs 5.0s)

// Rank by fastest hard finality
const hardResult = await rankPaymentOptions(options, "fastest-hard-finality");
console.log(hardResult.best.network);  // "stellar-testnet" (5.0s vs 17m 10s)
```

---

## 7. Branch Strategy
- **Main Working Branch:** `x402-hackathon`
- **Feature Branches:** Create from `x402-hackathon` as needed

### Branch Comparison Summary

| Branch                    | Key Feature                               | Commits Ahead of Main |
|---------------------------|-------------------------------------------|-----------------------|
| `x402-hackathon`          | Full Stellar support + Paywall UI         | 24 commits            |
| `stellar-paywall-support` | Stellar paywall without hackathon changes | 23 commits            |
| `main`                    | Upstream (no Stellar)                     | —                     |

---

## 8. Phase 1 Status ✅

**Completed:**
1. ✅ `NetworkAnalysis` class with EVM and Stellar cost/finality estimation
2. ✅ `PaymentRanker` class with criteria-based selection (`lowest-cost`, `fastest-finality`)
3. ✅ 60s TTL caching with invalidation
4. ✅ Demo script (`pnpm demo`) showing decision process
5. ✅ Sponsored payments support
6. ✅ Chain health checker (unhealthy networks are skipped)
7. ✅ Multi-network comparison (N networks, order-independent)

**Missing (optional):**
- ❌ Unit tests for `NetworkAnalysis` and `PaymentRanker`

---

## 8.1 Phase 2 Status ✅

**Completed:**
1. ✅ **CLI Demo** (`examples/typescript/economic-load-balancer/cli/`)
   - Full integration with `NetworkAnalysis` SDK using real-time data
   - Three ranking criteria: `lowest-cost`, `fastest-soft-finality`, `fastest-hard-finality`
   - Displays both soft and hard finality for each network
   - Actual payment execution via x402-axios interceptor
   - Health checking with automatic unhealthy network filtering
   - Dry-run mode for testing without executing payments

2. ✅ **Network Analysis Package** (`examples/typescript/economic-load-balancer/network-analysis/`)
   - Modular package extracted from `scripts/network-selector/`
   - Real-time gas estimation (no hardcoded values)
   - Real-time finality measurement from blockchain data
   - Caching with configurable TTL
   - Health checking with timeout support

3. ✅ **Documentation Updates**
   - README.md updated with accurate examples and criteria
   - All documentation reflects real-time data usage
   - Clear distinction between soft and hard finality

**Key Improvements Over Phase 1:**
- ✅ Replaced all hardcoded values with real-time network data
- ✅ Added support for both soft and hard finality as separate criteria
- ✅ Modularized network analysis into reusable package
- ✅ Enhanced CLI with comprehensive network analysis display

---

## 9. Scripts & Tooling

Network selection scripts are available in `scripts/network-selector/`:

```bash
cd scripts/network-selector && pnpm install

# Run the full demo (NetworkAnalysis + PaymentRanker + Health)
pnpm demo

# Individual demos
pnpm demo:analysis     # NetworkAnalysis demo
pnpm demo:health       # Health check demo
pnpm demo:ranker       # PaymentRanker demo
pnpm demo:sponsored    # Sponsored payments demo

# Compare N networks (order doesn't matter)
pnpm compare                              # base-sepolia vs stellar-testnet
pnpm compare stellar base base-sepolia    # 3-way comparison
pnpm compare base --sponsored=base        # Mark base as sponsored

# Compare finality (N networks)
pnpm compare:finality                     # Soft finality (default)
pnpm compare:finality --type=hard         # Hard finality
pnpm compare:finality stellar base        # Order doesn't matter

# Individual network estimation
pnpm evm base-sepolia             # EVM gas estimation
pnpm stellar testnet              # Stellar fee estimation
```

**Supported Networks:** base, base-sepolia, stellar-testnet, stellar-mainnet

---

## 10. Economic Load Balancer Demos

The demos are located in `examples/typescript/economic-load-balancer/`:

### 10.1 Multi-Network Server

```bash
cd examples/typescript/economic-load-balancer/server
cp .env-local .env
pnpm install && pnpm dev
```

Serves `/premium/agent-insight` accepting both Base Sepolia and Stellar Testnet payments.

### 10.2 CLI Demo

```bash
cd examples/typescript/economic-load-balancer/cli
cp .env-local .env
pnpm install

# Choose by lowest cost (default)
pnpm cli

# Choose by different criteria
pnpm cli --criteria=lowest-cost             # Cheapest network
pnpm cli --criteria=fastest-soft-finality  # Fastest soft finality
pnpm cli --criteria=fastest-hard-finality  # Fastest hard finality
pnpm cli --dry-run                          # Show payment instructions without executing
```

**Key Features:**
- ✅ Real-time cost estimation (no hardcoded values)
- ✅ Real-time finality measurement from blockchain data
- ✅ Health checking (unhealthy networks are skipped)
- ✅ Three ranking criteria: lowest-cost, fastest-soft-finality, fastest-hard-finality
- ✅ Displays both soft and hard finality for each network
- ✅ Actual payment execution via x402-axios interceptor

### 10.3 React Dashboard

```bash
cd examples/typescript/economic-load-balancer/dashboard
pnpm install && pnpm dev
```

Open http://localhost:5173 to see:
- Live gas feeds for both networks
- Progress bars showing relative costs
- Criteria selector (Lowest Cost / Fastest Finality)
- Winner highlighted in green with decision log
