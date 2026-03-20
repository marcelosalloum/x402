# Design: `channel` Scheme for x402

## Context

x402 currently has one payment scheme (`exact`) which requires an on-chain transaction per request. For use cases involving many consecutive requests — LLM agents calling tool APIs, metered API access — the per-request on-chain overhead adds latency and cost.

The Stellar ecosystem has the [one-way-channel](https://github.com/stellar-experimental/one-way-channel) Soroban smart contract, which provides unidirectional payment channels with off-chain commitments.

## Design Decisions

### Scheme structure: Single multi-action scheme (Approach C)

One scheme named `channel` with an `action` field (`open`, `pay`, `top_up`, `close`). The facilitator's `settle` handles all actions — for `pay` it's a no-op (off-chain only), for others it submits on-chain. This keeps the x402 interface unchanged and is simplest for server implementors.

### Channel lifecycle mapped to 402 flow

The first 402 response includes the factory contract address. The client opens a channel on the first request; subsequent requests reuse it via off-chain commitments. The facilitator tracks channel state and includes the `channelId` in 402 responses when a channel exists.

### Facilitator manages state

The facilitator (not the client) tracks (client, server, token) → channel mappings. It has on-chain visibility and manages settlement timing.

### Pre-pay per request

Client sends a commitment for `previous_cumulative + request_price` with each request. Server/facilitator verifies before granting access. Fits x402's request-response model.

### Settlement follows contract lifecycle

- `settle` (contract function): facilitator claims accumulated funds without closing
- `close`: recipient-side close with latest commitment
- `close_start` + `refund`: funder-initiated close with waiting period
- Facilitator watches on-chain events and reacts

### Close is signal-only

`close` action contains a signature proving the funder intends to close, but no new commitment. The facilitator uses the latest stored commitment. If the client needs to pay for one more request, they `pay` first, then `close`.

### Insufficient balance returns state, doesn't close

When a `pay` exceeds available balance, the facilitator returns an error with channel state. The channel stays open — the client can top up or close at their discretion.

### Commitment key flexibility

The client can use a dedicated ed25519 keypair (hot key for fast signing) or their Stellar account key.

## Spec Files

- `specs/schemes/channel/scheme_channel.md` — General scheme spec
- `specs/schemes/channel/scheme_channel_stellar.md` — Stellar-specific spec

## Future Work

- **Facilitator/Server split**: Contract modification to separate operational control (facilitator) from fund destination (server). Flagged with `> [!NOTE]` blocks throughout the spec.
- **Semi-trusted facilitator model**: Challenge path for the actual recipient if needed.
- **Additional networks**: EVM, SVM implementations of the channel scheme.
