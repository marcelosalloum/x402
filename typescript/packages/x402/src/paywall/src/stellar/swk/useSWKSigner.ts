import { useMemo } from "react";
import { ISupportedWallet, StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { type SignAuthEntry, type SignTransaction } from "@stellar/stellar-sdk/contract";
import { getNetworkPassphrase, type Ed25519Signer } from "../../../../shared/stellar";
import { type PaymentRequirements } from "../../../../types/verify";

type UseSWKSignerParams = {
  address: string | null;
  paymentRequirement: PaymentRequirements;
  kit: StellarWalletsKit | null;
  swkWallet: ISupportedWallet | null;
};

/**
 * Creates a Stellar signer that uses Stellar Wallet Kit for signing.
 *
 * @param params - Hook parameters.
 * @param params.address - Wallet address to sign with.
 * @param params.paymentRequirement - Payment requirement containing network info.
 * @param params.kit - Stellar Wallet Kit instance.
 * @param params.swkWallet - Stellar Wallet Kit wallet instance.
 * @returns A Stellar signer or null if not available.
 */
export function useSWKSigner({
  address,
  paymentRequirement,
  kit,
  swkWallet,
}: UseSWKSignerParams): Ed25519Signer | null {
  return useMemo(() => {
    if (!address || !kit || !swkWallet) {
      return null;
    }

    const signAuthEntryFunc: SignAuthEntry = async (
      authEntry: string,
      opts?: {
        networkPassphrase?: string;
        address?: string;
      },
    ) => {
      try {
        const signingResult = await kit.signAuthEntry(authEntry, {
          address,
          networkPassphrase:
            opts?.networkPassphrase || getNetworkPassphrase(paymentRequirement.network),
        });

        let { signedAuthEntry } = signingResult;
        if (!signedAuthEntry) {
          return {
            signedAuthEntry: "",
            error: {
              message: `Wallet ${swkWallet.name} did not return a signed auth entry.`,
              code: 0,
            },
          };
        }
        signedAuthEntry = fixSWKSignedAuthEntryIfNeeded(swkWallet, signedAuthEntry);

        return {
          signedAuthEntry,
          signerAddress: signingResult.signerAddress || address,
        };
      } catch (error) {
        return {
          signedAuthEntry: "",
          error: {
            message: error instanceof Error ? error.message : "Failed to sign auth entry.",
            code: 0,
          },
        };
      }
    };

    const signTransactionFunc = async () => {
      throw new Error("SWK signTransaction should not be called directly in this application.");
    };

    return {
      address,
      signAuthEntry: signAuthEntryFunc,
      signTransaction: signTransactionFunc as SignTransaction,
    };
  }, [address, paymentRequirement, kit]);
}

/**
 * Fixes the signed auth entry if needed for the Stellar Wallet Kit.
 * SWK is re-encoding the already encoded signature, so we have to revert that mistake here while their fix is still not published.
 *
 * @param wallet - The wallet provided through the SWK API.
 * @param signedAuthEntry - The signed auth entry returned by the SWK API.
 * @returns The fixed signed auth entry, in case of Freighter wallet, or the original signed auth entry otherwise.
 */
export const fixSWKSignedAuthEntryIfNeeded = (
  wallet: ISupportedWallet,
  signedAuthEntry: string,
): string => {
  if (wallet.id === "freighter") {
    return Buffer.from(signedAuthEntry, "base64").toString("utf-8");
  }

  return signedAuthEntry;
};
