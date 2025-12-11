# HACKATHON_MASTER_PLAN.md
> **Status:** 🟡 In-Progress / Planning Phase
> **Goal:** Build the "Economic Load Balancer" for x402 (Stellar + EVM)
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
- [ ] **Phase 0: Recon & Alignment**: Compare forks, validate schemas, test gas estimation with PoC spikes
- [ ] **Phase 1: The Core SDK**: NodeJS/TS implementation of the ranking logic
- [ ] **Phase 2: CLI Demo**: A script that requests a resource and logs the decision process
- [ ] **Phase 3: Web Dashboard**: React app visualizing the "Race" between chains, where the user can see the cost, speed, and finality of each chain, and choose the best one from a dropdown or a button to "Pay". Check the paywall from `examples/tpescript/fullstack/next`

## 4. Open Questions (Agents to Answer)
- [ ] *Does the current `x402-hackathon` branch fully implement the `accepts` schema provided?*
- [ ] *What is the best API to get Base Sepolia gas fees without an API key (or using public RPCs)?*
- [ ] *How do we simulate "gas price surges" to show the Load Balancer switching chains?*

## 5. Branch Strategy
- **Base Branch:** `hackathon/load-balancer` (create from `stellar-paywall-support`)