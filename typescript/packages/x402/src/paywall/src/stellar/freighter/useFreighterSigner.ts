import { useMemo } from "react";
import { signAuthEntry } from "@stellar/freighter-api";
import { getNetworkPassphrase, type Ed25519Signer } from "../../../../shared/stellar";
import type { PaymentRequirements } from "../../../../types/verify";
import { SignAuthEntry, SignTransaction } from "@stellar/stellar-sdk/contract";

type UseFreighterSignerParams = {
  address: string | null;
  paymentRequirement: PaymentRequirements;
};

type UseFreighterSignerReturn = Ed25519Signer | null;

/**
 * Creates a Stellar signer that uses Freighter wallet for signing.
 *
 * @param params - Hook parameters.
 * @param params.address - Wallet address to sign with.
 * @param params.paymentRequirement - Payment requirement containing network info.
 * @returns A Stellar signer or null if not available.
 */
export function useFreighterSigner({
  address,
  paymentRequirement,
}: UseFreighterSignerParams): UseFreighterSignerReturn {
  return useMemo(() => {
    if (!address) {
      return null;
    }

    const signAuthEntryFunc: SignAuthEntry = async (
      authEntry: string,
      opts?: {
        networkPassphrase?: string;
        address?: string;
      },
    ) => {
      const { signedAuthEntry, error } = await signAuthEntry(authEntry, {
        address,
        networkPassphrase:
          opts?.networkPassphrase || getNetworkPassphrase(paymentRequirement.network),
      });

      if (error) {
        return {
          signedAuthEntry: "",
          error: {
            message: error,
            code: 0,
          },
        };
      }

      if (!signedAuthEntry) {
        return {
          signedAuthEntry: "",
          error: {
            message: "Freighter did not return a signed auth entry.",
            code: 0,
          },
        };
      }

      return {
        signedAuthEntry,
        signerAddress: address,
      };
    };

    const signTransactionFunc = async () => {
      throw new Error("Freighter signTransaction should not be called directly.");
    };

    return {
      address,
      signAuthEntry: signAuthEntryFunc,
      signTransaction: signTransactionFunc as SignTransaction,
    };
  }, [address, paymentRequirement]);
}
