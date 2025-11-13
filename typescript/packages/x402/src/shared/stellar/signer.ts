import { Keypair } from "@stellar/stellar-sdk";

export type Ed25519Signer = Keypair;

/**
 * Creates a Stellar signer for the given network.
 *
 * @param privateKey - The private key of a Stellar classic (G) account to use for signing transactions
 * @returns A Stellar signer
 */
export function createStellarSigner(privateKey: string): Ed25519Signer {
  return Keypair.fromSecret(privateKey);
}

/**
 * Checks if the given wallet is a Stellar signer wallet.
 *
 * @param wallet - The object wallet to check.
 * @returns True if the wallet satisfies the StellarSigner interface.
 */
export function isEd25519Signer(wallet: unknown): wallet is Ed25519Signer {
  return wallet instanceof Keypair && wallet.canSign();
}
