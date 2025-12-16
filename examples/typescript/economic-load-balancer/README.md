# x402 Economic Load Balancer

**Automatic payment routing for optimal cost and speed**

This demo showcases the x402 Economic Load Balancer, which automatically selects the best blockchain network (Base Sepolia or Stellar Testnet) for payments based on real-time cost and finality analysis.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Dashboard    │────▶│  Multi-Network  │────▶│   Facilitator   │
│   (React/Vite)  │     │     Server      │     │   (x402.org)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│   CLI Client    │     │ Network Selector│
│  (PaymentRanker)│────▶│      SDK        │
└─────────────────┘     └─────────────────┘
```

## Components

### 1. Server (`/server`)

Multi-network Express server that accepts payments from both Base Sepolia and Stellar Testnet.

```bash
cd server
cp .env-local .env
pnpm install
pnpm dev
```

**Endpoints:**
- `GET /health` - Health check
- `GET /networks` - List supported networks
- `GET /premium/agent-insight` - Premium content ($0.001 USDC)
- `GET /weather` - Weather data ($0.0001 USDC)

### 2. CLI Demo (`/cli`)

Command-line client that demonstrates the PaymentRanker choosing the optimal network.

```bash
cd cli
cp .env-local .env
# Edit .env with your private keys
pnpm install

# Run with different criteria
pnpm cli                                    # Default: lowest-cost
pnpm cli --criteria=lowest-cost             # Choose cheapest network
pnpm cli --criteria=fastest-soft-finality   # Choose fastest soft finality
pnpm cli --criteria=fastest-hard-finality   # Choose fastest hard finality
```

**Example Output:**
```
╔══════════════════════════════════════════════════════════════╗
║       x402 Economic Load Balancer - CLI Demo                 ║
╚══════════════════════════════════════════════════════════════╝

📡 Fetching payment requirements from server...
✅ Received 2 payment options:

   • base-sepolia: 1000 USDC
   • stellar-testnet: 1000 USDC

🔍 Analyzing networks (criteria: lowest-cost)...

📊 Network Analysis:
────────────────────────────────────────────────────────────────

🏆 [1st] base-sepolia
   Fee:        0.000266 USDC
   Native:     0.000000086000 ETH
   Soft Finality: 2.0s
   Hard Finality: 17m 0s
   Health:     🟢 Healthy (172ms)

   [2nd] stellar-testnet
   Fee:        0.002195 USDC
   Native:     0.0092000 XLM
   Soft Finality: 5.0s
   Hard Finality: 5.0s
   Health:     🟢 Healthy (306ms)

────────────────────────────────────────────────────────────────

🏆 Selected: base-sepolia
   Reason: base-sepolia is 8.3x cheaper (0.000266 vs 0.002195 USDC)
```

### 3. Dashboard (`/dashboard`)

React web application visualizing the load balancer decision process.

```bash
cd dashboard
pnpm install
pnpm dev
```

Open http://localhost:5173 in your browser.

**Features:**
- Live gas feed for both networks (updates every 5s)
- Progress bars showing relative costs
- Three criteria buttons:
  - 💰 **Lowest Cost** - Select cheapest network
  - ⚡ **Soft Finality** - Fastest initial confirmation
  - 🔒 **Hard Finality** - Fastest irreversible finality
- Rankings displayed as 1st, 2nd, etc.
- Trophy emoji (🏆) highlights the winning network
- **Caching**: Results cached for 60s with cache hit indicator in log
- Decision log with clear "X times faster/cheaper" comparisons
- Demo mode indicator (no actual payments in demo)

## Quick Start

1. **Start the server:**
   ```bash
   cd server && pnpm install && pnpm dev
   ```

2. **Run the CLI demo:**
   ```bash
   cd cli && pnpm install && pnpm cli
   ```

3. **Or view the dashboard:**
   ```bash
   cd dashboard && pnpm install && pnpm dev
   ```

## Network Comparison

| Metric | Base Sepolia | Stellar Testnet |
|--------|--------------|-----------------|
| Gas Fee | ~$0.0003 USDC | ~$0.002 USDC |
| Soft Finality | ~2s | ~5s |
| Hard Finality | ~15m | ~5s |
| Best For | Low cost | Fast hard finality |

## How It Works

1. **Server returns 402** with payment options for both networks
2. **PaymentRanker analyzes** each network's cost and finality
3. **Best network is selected** based on the chosen criteria
4. **Rankings displayed** as 1st, 2nd, etc. with clear comparison
5. In production, **payment would be executed** on the winning network

## Criteria Explained

- **Lowest Cost**: Ranks networks by transaction fee (gas cost in USDC)
- **Soft Finality**: Ranks by time to first confirmation (sequencer confirmation for L2, ledger close for Stellar)
- **Hard Finality**: Ranks by time to irreversible finality (L1 settlement for L2 ~15min, immediate for Stellar ~5s)

## Demo Mode

The dashboard runs in demo mode and does not execute actual payments. When clicking "Buy Now":
- Networks are analyzed and ranked
- The decision log shows which network would be selected
- A warning indicates no actual transaction is created

To execute real payments, configure private keys in the CLI and use the CLI demo.

## Integration with Network Analysis SDK

The CLI uses the `NetworkAnalysis` SDK from the local `network-analysis/` package, which provides real-time cost and finality estimation:

```typescript
import { rankPaymentOptions } from "./network-ranker.js";

// Rank by lowest cost
const result = await rankPaymentOptions(options, "lowest-cost");
console.log(result.best.network);  // "base-sepolia"
console.log(result.reason);        // "base-sepolia is 6.8x cheaper than stellar-testnet"

// Rank by fastest soft finality
const softResult = await rankPaymentOptions(options, "fastest-soft-finality");

// Rank by fastest hard finality
const hardResult = await rankPaymentOptions(options, "fastest-hard-finality");
```

The `network-analysis/` package uses real-time data from:
- **EVM networks**: Live gas prices via viem, actual transaction simulation
- **Stellar networks**: Live fee stats via Soroban RPC, transaction simulation
- **Finality**: Measured from recent blockchain data (blocks/ledgers)

## Environment Variables

### Server
- `PORT` - Server port (default: 4021)
- `FACILITATOR_URL` - x402 facilitator URL
- `BASE_SEPOLIA_ADDRESS` - EVM payment address
- `STELLAR_ADDRESS` - Stellar payment address

### CLI
- `RESOURCE_SERVER_URL` - Server URL
- `ENDPOINT_PATH` - Endpoint to request
- `EVM_PRIVATE_KEY` - Base Sepolia wallet private key
- `STELLAR_PRIVATE_KEY` - Stellar wallet secret key

## Hackathon Submission

This demo is part of the x402 Hackathon submission for the **Economic Load Balancer** project.

**Key Features:**
- ✅ Real-time cost comparison across networks
- ✅ Automatic network selection based on criteria
- ✅ Health checking (skip unhealthy networks)
- ✅ Multi-network payment support
- ✅ Three ranking criteria (cost, soft finality, hard finality)
- ✅ Beautiful visualization dashboard with clear rankings
