# Scheme: `channel` on `Stellar`

## Versions supported

- ❌ `v1` - not supported
- ✅ `v2`

## Supported Networks

This spec uses [CAIP-2](https://namespaces.chainagnostic.org/stellar/caip2) identifiers:
- `stellar:pubnet` — Stellar mainnet
- `stellar:testnet` — Stellar testnet

## Summary

The x402 `channel` scheme on Stellar uses the [one-way-channel](https://github.com/stellar-experimental/one-way-channel) Soroban smart contract. The client deposits tokens into a channel via a factory contract, then pays per-request with off-chain ed25519-signed commitments. The facilitator sponsors on-chain transactions and manages settlement.

> [!NOTE]
> **Scope:** This spec covers [SEP-41]-compliant Soroban tokens **only**. Classic Stellar assets are only supported through [SEP-41] compliant [SAC](https://developers.stellar.org/docs/tokens/stellar-asset-contract) contracts.

## Protocol Flow

The protocol has four phases: **open**, **pay**, **top_up**, and **close**.

### 1. Open — Create a Channel

1. **Client** makes a request to a **Resource Server**.
2. **Resource Server** responds with `402 Payment Required` containing `PaymentRequirements` with `scheme: "channel"` and `extra.factoryContract`.
3. **Client** builds a `invokeHostFunction` transaction calling the factory contract's `open(funder, recipient, token, deposit, commitmentKey, ...)` function.
4. **Client** signs the authorization entries with their wallet.
5. **Client** sends the `PaymentPayload` with `action: "open"` to the resource server.
6. **Resource Server** forwards to the **Facilitator's** `/verify` endpoint and upon success to `/settle`.
7. **Facilitator** validates the transaction, sponsors fees, and submits on-chain.
8. **Facilitator** returns `SettleResponse` with the `channelId` (deployed channel contract address) and balance.
9. **Resource Server** grants access and returns the `channelId` to the **Client**.

> [!NOTE]
> **Pending: Facilitator/Server Split.** The `open` call will need to accept two recipient addresses: the facilitator (operational control) and the server (fund destination). Until the contract supports this, the facilitator address is treated as the recipient in this document.

### 2. Pay — Off-Chain Commitment

1. **Client** makes a request with `PaymentPayload` containing `action: "pay"`, the `channelId`, a `cumulativeAmount` (previous cumulative + request price), and an ed25519 `signature`.
2. **Resource Server** forwards to the **Facilitator**.
3. **Facilitator** verifies the commitment signature against the channel's `commitmentKey`, checks the amount is valid, and stores the commitment.
4. **Facilitator** returns success with updated channel state (no on-chain transaction).
5. **Resource Server** grants access.

### 3. Top Up — Add Funds

1. **Client** builds a transaction calling `top_up(amount)` on the channel contract.
2. **Client** signs auth entries and sends `PaymentPayload` with `action: "top_up"`.
3. **Facilitator** validates, sponsors, and submits on-chain.
4. **Facilitator** updates its tracked deposit balance.

### 4. Close — Settle and Close the Channel

1. **Client** sends `PaymentPayload` with `action: "close"`, the `channelId`, and a `signature` proving they are the funder and intend to close.
2. **Facilitator** verifies the close signature, then calls `close(amount, signature)` on the channel contract using the latest commitment it has stored.
3. The contract transfers the committed amount to the recipient and refunds the remainder to the funder.
4. **Facilitator** returns `SettleResponse` with the transaction hash.

> [!NOTE]
> `close` does not include a new commitment — the facilitator uses the latest commitment already received via `pay` actions. If the client needs to pay for one more request, they send a `pay` first, then `close` separately.

## `PaymentRequirements` for `channel`

In addition to the standard x402 `PaymentRequirements` fields, the `channel` scheme on Stellar requires the following inside the `extra` field.

```json
{
  "scheme": "channel",
  "network": "stellar:testnet",
  "amount": "1000000",
  "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "payTo": "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO",
  "maxTimeoutSeconds": 60,
  "extra": {
    "factoryContract": "CDXYZ...",
    "areFeesSponsored": true,
    "suggestedDeposit": "100000000"
  }
}
```

**Field Definitions:**

| Field | Required | Description |
|-------|----------|-------------|
| `amount` | Yes | Price per request in base units |
| `asset` | Yes | SEP-41 token contract address |
| `payTo` | Yes | Server's fund-receiving address |
| `maxTimeoutSeconds` | Yes | Max time for auth entry expiration |
| `extra.factoryContract` | Yes | Address of the channel factory contract |
| `extra.areFeesSponsored` | Yes | Whether the facilitator sponsors on-chain fees |
| `extra.suggestedDeposit` | No | Suggested initial deposit (advisory) |

> [!NOTE]
> **Pending: Facilitator/Server Split.** Currently `payTo` and the on-chain recipient are the same (the facilitator address). Once the contract supports the split, `payTo` will be the server's fund-receiving address, and the facilitator address will be separate. The `open` factory call will pass both addresses.

## `PaymentPayload` `payload` Field

The `payload` field of the `PaymentPayload` varies by action. The full `PaymentPayload` object:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://example.com/api",
    "description": "Access to protected API",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "channel",
    "network": "stellar:testnet",
    "amount": "1000000",
    "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "payTo": "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO",
    "maxTimeoutSeconds": 60,
    "extra": {
      "factoryContract": "CDXYZ...",
      "areFeesSponsored": true,
      "suggestedDeposit": "100000000"
    }
  },
  "payload": { "...different per action, see below..." }
}
```

### action: `open`

```json
{
  "action": "open",
  "transaction": "AAAAAgAAAA...",
  "commitmentKey": "GDXYZ..."
}
```

- `transaction`: Base64-encoded XDR of the Stellar transaction calling the factory's `open` function with signed authorization entries.
- `commitmentKey`: The ed25519 **public key** used for signing commitments. Can be a dedicated keypair or the client's Stellar account key.

### action: `pay`

```json
{
  "action": "pay",
  "channelId": "CABC123...",
  "cumulativeAmount": "2000000",
  "signature": "base64-encoded-ed25519-sig"
}
```

- `channelId`: The channel contract address.
- `cumulativeAmount`: The new cumulative total owed. Must equal previous cumulative + the `amount` from the 402 challenge.
- `signature`: Ed25519 signature over `(cumulativeAmount, channelId)` matching the one-way-channel contract's commitment format, signed with the `commitmentKey`.

### `top_up`

```json
{
  "action": "top_up",
  "channelId": "CABC123...",
  "transaction": "AAAAAgAAAA..."
}
```

- `transaction`: Base64-encoded XDR calling `top_up(amount)` on the channel contract with signed auth entries.

### `close`

```json
{
  "action": "close",
  "channelId": "CABC123...",
  "signature": "base64-encoded-sig-over-close-intent"
}
```

- `signature`: Ed25519 signature over `(channelId, "close")` signed with the `commitmentKey`, proving the funder intends to close. This is purely facilitator-side verification — the on-chain `close` call uses the recipient's `require_auth()`. The format is intentionally distinct from payment commitment signatures to prevent ambiguity.

## `SettleResponse`

### `open`

```json
{
  "success": true,
  "transaction": "a1b2c3d4e5f6...",
  "network": "stellar:testnet",
  "payer": "GFUNDER...",
  "channelId": "CABC123...",
  "deposit": "100000000",
  "remainingBalance": "100000000",
  "currentCumulative": "0"
}
```

### `pay`

```json
{
  "success": true,
  "network": "stellar:testnet",
  "channelId": "CABC123...",
  "currentCumulative": "2000000",
  "remainingBalance": "98000000"
}
```

No `transaction` field — nothing went on-chain.

### `top_up`

```json
{
  "success": true,
  "transaction": "f6e5d4c3b2a1...",
  "network": "stellar:testnet",
  "channelId": "CABC123...",
  "deposit": "200000000",
  "remainingBalance": "198000000",
  "currentCumulative": "2000000"
}
```

### `close`

```json
{
  "success": true,
  "transaction": "1a2b3c4d5e6f...",
  "network": "stellar:testnet",
  "channelId": "CABC123...",
  "finalAmount": "50000000",
  "refunded": "150000000"
}
```

## Facilitator Verification Rules (MUST)

A facilitator verifying a `channel` scheme on Stellar MUST enforce the following checks per action.

### `open` — Verification

#### 1. Protocol Validation

- The `x402Version` MUST be `2`.
- Both `payload.accepted.scheme` and `requirements.scheme` MUST be `"channel"`.
- The `payload.accepted.network` MUST match `requirements.network`.

#### 2. Transaction Structure

- The transaction MUST contain exactly **1 operation** of type `invokeHostFunction`.
- The function type MUST be `hostFunctionTypeInvokeContract`.
- The contract address MUST match `requirements.extra.factoryContract`.
- The function MUST be the factory's `open` function.
- The `recipient` argument MUST match `requirements.payTo`.
- The `token` argument MUST match `requirements.asset`.

> [!NOTE]
> **Pending: Facilitator/Server Split.** The `open` transaction arguments validation will need to verify both the facilitator address and the server (`payTo`) address match expected values.

#### 3. Authorization Entries

- The transaction MUST contain signed authorization entries for the funder address.
- Auth entries MUST use credential type `sorobanCredentialsAddress` only.
- The `rootInvocation` MUST NOT contain `subInvocations` that authorize additional operations.
- The auth entry expiration ledger MUST NOT exceed `currentLedger + ceil(maxTimeoutSeconds / estimatedLedgerSeconds)` (fallback to `5` seconds).

#### 4. Facilitator Safety

- The transaction source account MUST NOT be the facilitator's address.
- The operation source account MUST NOT be the facilitator's address.
- The facilitator MUST NOT be the `funder` address.
- The facilitator address MUST NOT appear in any authorization entries.

#### 5. No Duplicate Channel

- There MUST NOT be an existing open channel for this (funder, recipient, token) tuple.

#### 6. Simulation

- The facilitator MUST simulate the transaction against the current ledger state.
- The simulation MUST succeed without errors.

### `pay` — Verification

1. **Channel exists**: `channelId` MUST reference a channel tracked by the facilitator with status `open`.
2. **Signature**: The ed25519 signature over `(cumulativeAmount, channelId)` MUST verify against the channel's `commitmentKey`.
3. **Exact increment**: `cumulativeAmount - currentCumulative` MUST equal the required `amount` from the 402 challenge.
4. **Balance**: `cumulativeAmount` MUST NOT exceed the channel's deposit minus any on-chain settlements.

### `top_up` — Verification

1. **Channel exists**: `channelId` MUST reference a channel tracked by the facilitator with status `open`.
2. **Transaction structure**: The transaction MUST call `top_up` on the correct channel contract address.
3. **Authorization entries**: MUST be signed by the original funder of the channel.
4. **Facilitator safety**: Same rules as `open` — the facilitator MUST NOT appear as source, funder, or in auth entries.
5. **Simulation**: MUST succeed without errors.

### `close` — Verification

1. **Channel exists**: `channelId` MUST reference a channel tracked by the facilitator with status `open`.
2. **Signature**: The ed25519 signature over `(channelId, "close")` MUST verify against the channel's `commitmentKey`, confirming the funder intends to close.

## Settlement Logic

### `open` — Settlement

1. Parse the client's signed transaction XDR.
2. Rebuild a new transaction with the **facilitator** as source account (sponsors fees).
3. Copy operations and auth entries from the client's transaction.
4. Sign and submit to the Stellar network via RPC `sendTransaction`.
5. Poll for confirmation.
6. Initialize facilitator-side channel state: store `channelId`, `funder`, `recipient`, `token`, `commitmentKey`, `deposit`, `currentCumulative: 0`, `status: open`.

### `pay` — Settlement

1. Store the new commitment (`cumulativeAmount`, `signature`) as the latest for this channel.
2. Update `currentCumulative` and `remainingBalance`.
3. Return success with updated channel state. **No on-chain transaction.**

### `top_up` — Settlement

1. Rebuild and submit the transaction (same process as `open`).
2. Update the channel's `deposit` balance.

### `close` — Settlement

1. Retrieve the latest stored commitment (`currentCumulative`, `latestSignature`).
2. Build a transaction calling `close(currentCumulative, latestSignature)` on the channel contract.
3. Sign with the facilitator's key and submit on-chain.
4. Set channel status to `closed`.

> [!NOTE]
> **Future: Facilitator/Server Split.** Once the contract supports separate facilitator and server addresses, `settle` and `close` will transfer funds to the server address. The facilitator calls the contract functions but the funds flow to `payTo`.

## Facilitator State Machine

### Per-Channel State

| Field | Description |
|-------|-------------|
| `channelId` | Channel contract address |
| `funder` | Client's Stellar address |
| `recipient` | Server's `payTo` address |
| `token` | Asset contract address |
| `commitmentKey` | Ed25519 public key for commitment verification |
| `deposit` | Total deposited amount |
| `currentCumulative` | Highest valid cumulative commitment received |
| `latestSignature` | Signature for `currentCumulative` |
| `status` | `open`, `closing`, `closed` |

> [!NOTE]
> **Pending: Facilitator/Server Split.** The `recipient` field will be split into `facilitator` (operational control) and `server` (fund destination).

### State Transitions

```
                open (on-chain confirmed)
                         |
                         v
              +--- OPEN <---+
              |       |     |
              |  pay (off-chain)
              |  top_up (on-chain)
              |       |     |
              +-------+-----+
                      |
       close_start       OR      client sends close action
       detected on-chain         directly to the contract
              |                        |
              v                        v
          CLOSING                   CLOSED
    (facilitator submits       (facilitator submits
     close before expiry)       close on-chain)
              |
              v
           CLOSED
```

### On-Chain Event Monitoring

The one-way-channel contract emits the following events:

| Contract Event | Emitted By | Parameters |
|----------------|------------|------------|
| `Open` | Factory (constructor) | `from`, `commitment_key`, `to`, `token`, `amount`, `refund_waiting_period` |
| `Close` | `close` and `close_start` | `effective_at_ledger` |
| `Withdraw` | `settle` and `close` | `to`, `amount` |
| `Refund` | `refund` | `from`, `amount` |

> [!NOTE]
> `top_up` does not emit an event. The facilitator tracks top-ups by submitting them on behalf of the client, so it already knows the new balance.

**Facilitator responses to events:**

| Event | Facilitator Action |
|-------|-------------------|
| `Open` | Initialize channel state, store `channelId` |
| `Close` with future `effective_at_ledger` | `close_start` detected — set status to `closing`, submit `close` with latest commitment before the waiting period expires |
| `Close` with immediate `effective_at_ledger` | Channel closed — set status to `closed` |
| `Withdraw` | Update settled amount (relevant when facilitator itself calls `settle`) |
| `Refund` | Set status to `closed` |

### Proactive Settlement

The facilitator can periodically call `settle` on the channel contract with the latest commitment to claim accumulated funds without closing the channel. This reduces the server's risk exposure. The timing is an internal facilitator decision — the client and server do not need to be aware of it.

The `settle` call is not triggered by any client action — it is a facilitator-internal operation. The facilitator builds a transaction calling `settle(currentCumulative, latestSignature)` on the channel contract, signs it as the recipient, and submits on-chain. The contract transfers only the delta (`currentCumulative - previouslyWithdrawn`) to the recipient.

## Error Handling

Errors use `channel`-specific problem types.

| Error | Status | Problem Type | When |
|-------|--------|-------------|------|
| Insufficient balance | 402 | `channel/insufficient-balance` | `pay` commitment exceeds channel balance |
| Channel not found | 404 | `channel/not-found` | `pay`, `top_up`, or `close` references unknown `channelId` |
| Channel already exists | 409 | `channel/already-exists` | `open` when a channel exists for this (client, server, token) |
| Channel closed/closing | 410 | `channel/finalized` | `pay` or `top_up` on a closed or closing channel |
| Invalid signature | 402 | `channel/invalid-signature` | Commitment or close signature doesn't verify |
| Amount mismatch | 402 | `channel/amount-mismatch` | `pay` where increment ≠ required `amount` |

### Insufficient Balance Response

When a `pay` commitment exceeds the channel's available balance, the facilitator returns the error with channel state so the client can decide how to proceed (top up or close):

```json
{
  "success": false,
  "error": "channel/insufficient-balance",
  "channelId": "CABC123...",
  "currentCumulative": "95000000",
  "remainingBalance": "3000000",
  "requiredAmount": "5000000"
}
```

### Facilitator Behavior on `close_start`

When the facilitator detects a `close_start` event on-chain (funder-initiated close):
1. Set channel status to `closing`.
2. Submit `close` with the latest valid commitment before the `refund_waiting_period` expires.
3. Any subsequent `pay` requests return `channel/finalized`.

## Contract Dependencies

The `channel` scheme on Stellar depends on the [one-way-channel](https://github.com/stellar-experimental/one-way-channel) Soroban smart contract.

### Contract Functions Used

| Function | Caller | x402 Usage |
|----------|--------|------------|
| Factory `open` | Funder (client) | Facilitator sponsors and submits on behalf of client |
| `settle` | Recipient (facilitator) | Facilitator periodically claims accumulated commitments without closing |
| `close` | Recipient (facilitator) | Facilitator submits final close with latest commitment |
| `close_start` | Funder (client) | Funder-initiated close; facilitator watches for this event |
| `refund` | Funder (client) | After waiting period, funder reclaims remaining balance |
| `top_up` | Funder (client) | Facilitator sponsors and submits; updates channel balance |

> [!NOTE]
> **Pending: Facilitator/Server Split.** Currently the facilitator is the on-chain recipient. In a future contract update, the recipient role will be split into two addresses: the **facilitator** (operational control — calls `settle`, `close`) and the **server** (receives funds). The contract will need to accept a trusted second auth party who can call `close`/`settle` on behalf of the actual recipient. This is a relatively straightforward change since x402 servers trust their facilitators — no challenge/dispute mechanism is needed. A semi-trusted model (where the recipient can challenge a facilitator's close) could be added later but is out of scope.
>
> Functions affected: `open` (accept both addresses), `settle` (transfer funds to server, not caller), `close` (same), and authorization checks (allow facilitator as trusted closer).

## Appendix

### Commitment Format

Commitments follow the one-way-channel contract's format. The signed message is `(cumulativeAmount, channelContractAddress)` – the cumulative total owed, bound to a specific channel. Cumulative semantics prevent replay: each commitment supersedes all previous ones.

### Close Intent Format

The close intent signature is over `(channelId, "close")` — a distinct format from payment commitments to prevent ambiguity between "pay this amount" and "close the channel."

### Authorization Patterns

Consistent with the `exact` scheme on Stellar, clients authorize invocations via auth entry signing (not full transaction signing). This supports both C-accounts and G-accounts and enables fee sponsorship by the facilitator.

[SEP-41]: https://stellar.org/protocol/sep-41
