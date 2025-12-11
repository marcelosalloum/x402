# HACKATHON_MASTER_PLAN.md
> **Status:** 🟢 Phase 0 Complete / Ready for Phase 1
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
- [ ] **Phase 1: The Core SDK**: NodeJS/TS implementation of the ranking logic
- [ ] **Phase 2: CLI Demo**: A script that requests a resource and logs the decision process
- [ ] **Phase 3: Web Dashboard**: React app visualizing the "Race" between chains, where the user can see the cost, speed, and finality of each chain, and choose the best one from a dropdown or a button to "Pay". Check the paywall from `examples/tpescript/fullstack/next`

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
import { getStellarFeeCost } from "./stellar-fee.js";

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

### 6.3 Unified Cost Comparator Interface

```typescript
import { PaymentRequirements, Network } from "x402/types";

export type CostEstimate = {
  network: Network;
  paymentAmount: bigint;       // The actual payment in atomic units
  networkFeeUsdc: string;      // Gas/transaction fee in USDC (unified)
  totalCostUsdc: string;       // Total cost in USDC
  finalityTimeMs: number;      // Expected finality time in milliseconds
  isSponsored: boolean;        // Whether facilitator sponsors fees
};

export interface ICostEstimator {
  estimate(requirement: PaymentRequirements, isSponsored?: boolean): Promise<CostEstimate>;
  isCacheValid(network: Network): boolean;
  invalidateCache(network: Network): void;
}

export interface IRankingEngine {
  rank(
    options: PaymentRequirements[],
    criteria: "price" | "speed" | "finality"
  ): PaymentRequirements;
}
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

## 8. Next Steps for Phase 1

1. **Continue using the `x402-hackathon` branch**
2. **Implement `ICostEstimator`** with concrete EVM and Stellar implementations
3. **Implement `IRankingEngine`** with criteria-based selection
4. **Create unit tests** for the estimator and ranking logic
5. **Build CLI demo** to show decision process

---

## 9. Scripts & Tooling

Gas estimation scripts are available in `scripts/gas-estimation/`:

```bash
cd scripts/gas-estimation && pnpm install

# EVM gas estimation (network as first argument, defaults to base-sepolia)
pnpm evm                          # Base Sepolia
pnpm evm base                     # Base mainnet
pnpm evm base-sepolia             # Base Sepolia testnet
pnpm evm base --sponsored         # Sponsored (cost = 0 USDC)
pnpm evm --list                   # List all supported networks

# Stellar fee estimation (network as first argument, defaults to stellar-testnet)
pnpm stellar                      # Stellar Testnet
pnpm stellar testnet              # Stellar Testnet (explicit)
pnpm stellar mainnet              # Stellar Mainnet
pnpm stellar stellar-mainnet      # Stellar Mainnet (explicit)
pnpm stellar --sponsored          # Sponsored (cost = 0 USDC)
pnpm stellar --list               # List supported networks

# Compare networks (EVM network as first argument, Stellar network as second)
pnpm compare                      # base-sepolia vs stellar-testnet
pnpm compare base stellar         # base vs stellar-testnet
pnpm compare base-sepolia stellar-mainnet  # base-sepolia vs stellar mainnet
pnpm compare base --evm-sponsored # Base with sponsored EVM fees
```

**Supported EVM Networks:** base, base-sepolia

**Supported Stellar Networks:** stellar-testnet, mainnet
