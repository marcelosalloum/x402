# Scheme: `channel`

## Summary

`channel` is a scheme that opens a unidirectional payment channel between a client and a resource server. Instead of paying on-chain for every request (as with `exact`), the client deposits funds once into an on-chain channel and then pays per-request via off-chain signed commitments. The facilitator manages on-chain settlement.

The primary benefit is **reduced latency**: after the initial channel opening, subsequent payments require only an off-chain signature verification — no blockchain transactions. This also **reduces cost** by amortizing on-chain fees across many payments.

## Example Use Cases

- An LLM agent making hundreds of API calls to a tool provider, paying per-request via off-chain commitments
- A client making many consecutive requests to a metered API, paying per-call without on-chain overhead each time
- High-frequency machine-to-machine payments where latency matters more than individual transaction receipts

## Lifecycle

The `channel` scheme is stateful with a multi-phase lifecycle managed through an `action` field in the payload:

| Action | On-chain? | Description |
|--------|-----------|-------------|
| `open` | Yes | Deploy channel via factory contract, deposit funds |
| `pay` | No | Off-chain commitment signature, grants resource access |
| `top_up` | Yes | Add funds to an existing channel |
| `close` | Yes | Close channel, settle with latest commitment |

All actions go through the standard x402 `verify`/`settle` facilitator interface. For `pay`, `settle` performs no on-chain transaction — it validates the commitment and returns the updated channel state. For `open`, `top_up`, and `close`, `settle` submits a transaction on-chain.

## Protocol Flow

```
Client                    Server                  Facilitator             Chain
  |                         |                         |                     |
  |--- GET /resource ------>|                         |                     |
  |<-- 402 (channel, extra: |                         |                     |
  |    factoryContract,     |                         |                     |
  |    payTo)               |                         |                     |
  |                         |                         |                     |
  |--- open (factory call,  |--- verify/settle ------>|--- submit open ---->|
  |    deposit, token,      |                         |    on-chain         |
  |    commitmentKey)       |<-- channelId, balance --|<-- channel addr ----|
  |<-- 200 + channelId -----|                         |                     |
  |                         |                         |                     |
  |--- pay (commitment      |--- verify/settle ------>|  (no on-chain tx)   |
  |    sig, cumAmount)      |<-- ok, balance, next ---|                     |
  |<-- 200 + resource ------|                         |                     |
  |                         |                         |                     |
  |  ... repeat pay ...     |                         |                     |
  |                         |                         |                     |
  |                         |    (optional, reduces   |---- settle -------->|
  |                         |     facilitator risk)   |    latest commit    |
  |                         |                         |                     |
  |--- close -------------->|--- verify/settle ------>|--- close on-chain ->|
  |<-- 200 + txHash --------|<-- txHash --------------|<-- settled ---------|
```

## Key Properties

- Commitments are **cumulative** (not incremental): a commitment for 250 means 250 total owed, not 250 more than before
- The client signs commitments with a `commitmentKey` — either a dedicated ed25519 keypair or the client's account key
- The facilitator is **stateful**: it tracks channel address, balance, latest commitment per (client, server, token) tuple
- The facilitator watches for on-chain events in case the funder/client triggers a `close_start` directly on the contract (bypassing x402). When detected, the facilitator submits the latest commitment before the waiting period expires to protect the server's funds
- The facilitator may optionally call `settle` on-chain periodically to claim accumulated commitments without closing the channel, reducing risk exposure
- If a `pay` commitment exceeds the channel's available balance, the facilitator returns an error with the channel state — the client can `top_up` or `close` at their discretion

> [!NOTE]
> **Pending: Facilitator/Server Split.** Currently the facilitator acts as the on-chain recipient. In a future update, the recipient role will be split: the **facilitator** retains operational control (calls `settle`, `close` on-chain) while the **server** (`payTo`) receives the actual funds. This is a trusted model — x402 servers trust their facilitators, so no challenge/dispute mechanism is needed. A semi-trusted model could be added later.

## Appendix

## Critical Validation Requirements

While implementation details vary by network, facilitators MUST enforce security constraints. See per-network documents for specifics:

- [`scheme_channel_stellar.md`](scheme_channel_stellar.md) (Stellar)

### General Requirements

- **Facilitator safety**: The facilitator MUST NOT appear as the funder or in any position that could cause it to lose its own funds.
- **Commitment integrity**: Off-chain commitment signatures MUST be verified against the channel's `commitmentKey` before granting access.
- **Monotonicity**: Each `pay` commitment MUST increment the cumulative amount by exactly the required `amount`.
- **Balance enforcement**: The cumulative amount MUST NOT exceed the channel's deposit (accounting for on-chain settlements).
