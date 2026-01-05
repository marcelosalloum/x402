# x402 Economic Load Balancer

## 🏆 x402 Hackathon Submission

**Automatic payment routing for optimal blockchain network selection**

> Built for the [x402 Hackathon](https://www.x402hackathon.com) — solving the multi-chain payment optimization problem for AI agents.

> [!IMPORTANT]
> **Stellar Network Support**: This project depends on code pending merge in [PR #711](https://github.com/coinbase/x402/pull/711), which adds Stellar network support to x402 (similar to the existing EVM & SVM support).

---

## The Problem

Current x402 agents are often **locked into a single chain**. While EVM L2s like Base are excellent for DeFi liquidity, they can suffer from congestion or higher costs during peak times. This makes them **suboptimal for high-frequency, low-value agent transactions**—for example, an AI Agent paying $0.001 for an API call 100 times a minute.

**Key Challenge**: Gas fees matter significantly when you're making hundreds or thousands of micro-payments per hour. A 10x difference in transaction costs can dramatically impact an agent's operational economics.

## The Solution

We built the **Economic Load Balancer**, a smart x402 client extension. Much like a web2 load balancer routes traffic to the healthiest server, our client analyzes the `402 Payment Required` headers and **automatically routes payments to the most cost-optimal network**.

### How It Works

1. **Interception**: The client intercepts the `402` error from a Resource Server
2. **Analysis**: It parses the `accepts` list to see supported networks (Base Sepolia & Stellar Testnet)
3. **Ranking**: Our `GasEstimator` service checks real-time fees (1-minute cache) and chooses the cheapest network—critical for high-volume scenarios
4. **Execution**: It signs and submits the transaction on the winning chain (Base or Stellar) without the Agent needing to manually switch contexts, leveraging the Stellar implementation from [PR #711](https://github.com/coinbase/x402/pull/711)

### Why This Matters

**Gas prices are critical for small, high-frequency payments**—the exact scenario where AI Agents operate. When you're making micro-payments at scale:

- **Cost savings compound**: A network that's 8x cheaper means 8x more operations for the same budget
- **Economic viability**: What's unprofitable on one network becomes viable on another
- **Agent autonomy**: Agents can make optimal decisions without human intervention

While time to finality (soft and hard) is also tracked and can be used as a ranking criterion, **cost optimization is the primary focus** for this hackathon submission.

## 🚀 Quick Start

Choose your preferred demo:

**Option 1: CLI Demo** (Best for developers)
```bash
cd cli && cp .env-local .env  # Add your private keys
pnpm install && pnpm cli

# Run with different criteria
pnpm cli                                    # Default: lowest-cost
pnpm cli --criteria=lowest-cost             # Choose cheapest network
pnpm cli --criteria=fastest-soft-finality   # Choose fastest soft finality
pnpm cli --criteria=fastest-hard-finality   # Choose fastest hard finality
pnpm cli --dry-run                          # Show payment instructions without executing
```

**Option 2: Dashboard** (Best for visualization)
```bash
# Terminal 1: Start server
cd server && cp .env-local .env && pnpm install && pnpm dev

# Terminal 2: Start dashboard
cd dashboard && pnpm install && pnpm dev
# Open http://localhost:5173
```

## 📊 Demo Components

| Component | Description | Key Features |
|-----------|-------------|--------------|
| **Server** (`/server`) | Multi-network Express server | Accepts Base & Stellar payments, returns real-time network costs |
| **CLI** (`/cli`) | Command-line agent demo | Automatic network selection, dry-run mode, cost comparison |
| **Dashboard** (`/dashboard`) | React visualization app | Live gas feed, wallet integration (MetaMask/Freighter), payment execution |

## Network Comparison

| Metric | Base Sepolia | Stellar Testnet |
|--------|--------------|-----------------|
| **Gas Fee** | ~$0.0003 USDC | ~$0.002 USDC |
| **Cost Difference** | **3-8x cheaper** | More expensive |
| Soft Finality | ~2s | ~5s |
| Hard Finality | ~15m | ~5s |
| **Best For** | **Low-cost, high-frequency** | Fast hard finality |

## How It Works

1. **402 Response** → Server returns payment options for Base Sepolia & Stellar Testnet
2. **Real-Time Analysis** → Client fetches live gas prices (60s cache) and ranks networks
3. **Smart Selection** → Automatically chooses most cost-efficient network (typically 3-8x savings)
4. **Seamless Payment** → Signs and submits transaction on optimal chain without manual switching
5. **Resource Access** → Returns protected content with transaction proof

## 💰 Cost Optimization Focus

**Lowest Cost** is our primary ranking criterion—essential for high-frequency agent operations. When making hundreds of micro-payments per hour:
- **3-8x cost difference** between networks = 3-8x more operations per dollar
- Makes previously unprofitable workflows economically viable
- Critical for autonomous agent sustainability

*Secondary criteria (soft/hard finality) also available but de-emphasized for this hackathon.*

## 🛠️ Technical Implementation

**CLI Example:**
```bash
pnpm cli --criteria=lowest-cost  # Automatically selects cheapest network
pnpm cli --dry-run               # Preview without executing
```

**SDK Integration:**
```typescript
import { rankPaymentOptions } from "./network-ranker.js";

const result = await rankPaymentOptions(options, "lowest-cost");
console.log(result.best.network);  // "base-sepolia"
console.log(result.reason);        // "base-sepolia currently 3.5x cheaper"
```

**Real-Time Data Sources:**
- Live gas prices via viem (EVM) and Soroban RPC (Stellar)
- Actual transaction simulation (EIP-3009 for EVM)
- Live crypto prices from Coinbase API
- 60-second caching for efficiency

<details>
<summary><b>Environment Variables</b></summary>

**Server:** `PORT`, `FACILITATOR_URL`, `BASE_SEPOLIA_ADDRESS`, `STELLAR_ADDRESS`  
**CLI:** `RESOURCE_SERVER_URL`, `ENDPOINT_PATH`, `EVM_PRIVATE_KEY`, `STELLAR_PRIVATE_KEY`

See `.env-local` files in each directory for templates.
</details>

---



## 🏆 Hackathon Submission Highlights

This demo showcases the **Economic Load Balancer** for the [x402 Hackathon](https://www.x402hackathon.com)—solving the critical problem of **cost optimization for high-frequency AI agent payments**.

### 🎯 Core Innovation

**Problem Solved**: Current x402 agents are locked to single chains, paying suboptimal gas fees for high-frequency micro-payments.

**Our Solution**: Intelligent multi-chain payment routing that automatically selects the most cost-efficient network in real-time.

### ✨ Key Features

**Cost Optimization (Primary Focus)**
- ✅ Real-time gas fee comparison across Base Sepolia & Stellar Testnet
- ✅ Automatic selection of cheapest network (typically 5-10x cost difference)
- ✅ 60-second caching for efficient high-frequency operations
- ✅ Live cryptocurrency price feeds for accurate USD cost calculations

**Multi-Chain Support**
- ✅ Stellar network integration from [PR #711](https://github.com/coinbase/x402/pull/711)
- ✅ Full EVM support (Base Sepolia, extensible to other EVM L2s)
- ✅ Unified payment interface—agents don't need to know chain details
- ✅ Dual wallet integration (MetaMask/Coinbase Wallet for EVM, Freighter for Stellar)

**Production-Ready Implementation**
- ✅ Beautiful React dashboard with real-time network visualization
- ✅ CLI tool for programmatic agent integration
- ✅ Multi-network Express server with 402 payment middleware
- ✅ Comprehensive error handling and health checking
- ✅ Transaction tracking with block explorer links
- ✅ Protected resource access after successful payment

### 🚀 Impact

For AI agents making 100 API calls/hour at $0.001 each:
- **Without load balancing**: Fixed costs on single chain
- **With Economic Load Balancer**: Automatic routing to cheapest network, saving up to 8x on gas fees

**This unlocks entirely new classes of agent workflows** that were previously economically unviable due to high gas costs.
