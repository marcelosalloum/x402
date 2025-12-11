# x402 Gas Estimation Scripts

Scripts for estimating **actual x402 payment transaction costs** across EVM and Stellar networks. All costs are normalized to USDC.

## What These Scripts Estimate

These scripts estimate the **real cost of x402 payments**:

| Network | Transaction Type | Typical Gas/Fee |
|---------|------------------|-----------------|
| **EVM** | EIP-3009 `transferWithAuthorization` | ~86,000 gas |
| **Stellar** | SEP-41 Soroban token transfer | ~91,000 stroops (resource + inclusion) |

## Setup

```bash
cd scripts/gas-estimation
pnpm install
```

## Usage

### EVM Gas Estimation

```bash
pnpm evm                        # Default: base-sepolia
pnpm evm base                   # Base mainnet
pnpm evm base-sepolia           # Base Sepolia testnet
pnpm evm base --sponsored       # Sponsored (cost = 0)
pnpm evm --list                 # List all supported networks
```

**Supported Networks:**
- `base`, `base-sepolia` (USDC ✓)

### Stellar Fee Estimation

```bash
pnpm stellar                    # Default: stellar-testnet
pnpm stellar testnet            # Stellar testnet (explicit)
pnpm stellar stellar-testnet    # Stellar testnet (full name)
pnpm stellar mainnet            # Stellar mainnet
pnpm stellar stellar-mainnet    # Stellar mainnet (explicit)
pnpm stellar --sponsored        # Sponsored (cost = 0)
pnpm stellar --list             # List supported networks
```

**Supported Networks:**
- `stellar-testnet` (https://soroban-testnet.stellar.org)
- `mainnet` (https://mainnet.sorobanrpc.com)

### Compare Networks

```bash
pnpm compare                    # base-sepolia vs stellar-testnet
pnpm compare base stellar       # base vs stellar-testnet
pnpm compare base-sepolia stellar-testnet  # explicit network names
pnpm compare base-sepolia stellar-mainnet  # base-sepolia vs stellar mainnet
pnpm compare base --evm-sponsored     # EVM fees sponsored
pnpm compare base --stellar-sponsored # Stellar fees sponsored
```

## Example Output

```
╔══════════════════════════════════════════════════════════════╗
║       x402 Economic Load Balancer - Cost Comparison          ║
║                 (Simulated x402 Transactions)                ║
╚══════════════════════════════════════════════════════════════╝

⛽ base-sepolia (EVM) [L2]
────────────────────────────────────────
   Chain ID:     84532
   Gas Price:    0.0012 Gwei
   Gas Limit:    86400 units
   L2 Execution: 0.000000104000 ETH
   L1 Data Fee:  0.000000000000 ETH
   Total Cost:   0.000000104000 ETH
   Total Cost:   0.000335 USDC
   Price Rate:   1 ETH = $3233 USD
   Sponsored:    No
   Simulated:    Yes
   Method:       EIP-3009 transferWithAuthorization

⭐ stellar-testnet (Stellar)
────────────────────────────────────────
   Token:        native-xlm
   Contract:     CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
   Total Fee:    91722 stroops (0.0091722 XLM)
   Total Fee:    0.002251 USDC
   Price Rate:   1 XLM = $0.2455 USD
   Sponsored:    No
   Simulated:    Yes
   Method:       Soroban token transfer (SEP-41 style)

🏆 Recommendation
────────────────────────────────────────
   Best Option:  ⛽ base-sepolia
   Reason:       EVM is 85.1% cheaper (0.000335 vs 0.002251 USDC)
```

## API Reference

### `getEvmFeeCost(network, isSponsored)`

```typescript
import { getEvmFeeCost } from "./evm-gas.js";

const estimate = await getEvmFeeCost("base-sepolia", false);
// {
//   network: "base-sepolia",
//   chainId: 84532,
//   nativeSymbol: "ETH",
//   nativeUsdPrice: 3230.55,        // Live price from Coinbase API
//   gasPriceGwei: "0.0012",
//   estimatedGasUnits: 86400n,     // EIP-3009 transferWithAuthorization (simulated)
//   estimatedCostNative: "0.000000103700",
//   estimatedCostUsdc: "0.000335",
//   isSponsored: false,
//   isSimulated: true
// }
```

### `getStellarFeeCost(network, isSponsored, rpcUrl?)`

```typescript
import { getStellarFeeCost } from "./stellar-fee.js";

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

## Price Data Source

**Live Price Oracle**: Uses Coinbase Pro API for real-time prices

| Token | API Endpoint | Fallback Price |
|-------|--------------|----------------|
| ETH   | `https://api.coinbase.com/v2/prices/ETH-USD/spot` | $3,200 |
| XLM   | `https://api.coinbase.com/v2/prices/XLM-USD/spot` | $0.24 |

**Fallback Behavior**: If API fails, scripts use hardcoded fallback prices and log warnings.

## Accuracy Assessment

**✅ Accurate Components:**
- EVM gas prices fetched live from RPC endpoints
- Stellar fee simulation using actual Soroban RPC
- Gas limits validated against EIP-3009 specifications
- L1 data costs calculated for Base/OP Stack chains

**📊 Validation Results:**
- Base gas: ~0.0012-0.0013 Gwei (matches external sources)
- Base Sepolia gas: ~0.0012 Gwei (matches external sources)
- Stellar fees: ~91,000-92,000 stroops (simulated with actual Soroban transfers)
- Gas limits: ~86,000 gas for EIP-3009 (validated via actual transaction simulation)

## Key Insights

### Transaction Costs
1. **Base/L2s are often cheaper** due to extremely low gas prices
2. **Stellar fees** include significant resource fees for Soroban contracts
3. **Sponsorship** makes either network free (facilitator pays)
4. **Gas prices fluctuate** — run scripts for real-time comparisons
5. **Live price oracle** ensures accurate USD conversions without manual updates
6. **Price transparency** — all exchange rates are displayed for verification
7. **Robust fallbacks** prevent failures if price APIs are unavailable

## Simulation Notes

- **EVM**: Simulates actual EIP-3009 `transferWithAuthorization` transactions using real signed data
  - Uses funded test wallet with USDC balance for accurate gas estimation
  - Falls back to ~85,000 gas if simulation fails
- **Stellar**: Simulates actual Soroban token transfers using native XLM contract
  - Uses funded test wallet for accurate resource fee calculation
  - Falls back to ~92,000 stroops if simulation fails
