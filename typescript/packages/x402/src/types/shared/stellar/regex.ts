export const StellarDestinationAddressRegex = /^(?:[GC][A-Z2-7]{55}|M[A-Z2-7]{68})$/; // Stellar address: G-account (56 chars), C-account (56 chars), or M-account (69 chars, muxed)
export const StellarAssetAddressRegex = /^(?:[C][A-Z2-7]{55})$/; // Stellar token contract address: C-account (56 chars)
