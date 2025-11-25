import { useCallback, useEffect, useState } from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  KleverModule,
} from "@creit.tech/stellar-wallets-kit";
import type { ISupportedWallet } from "@creit.tech/stellar-wallets-kit";

import type { PaymentRequirements } from "../../../../types/verify";
import { getNetworkPassphrase } from "../../../../shared/stellar";
import { statusClear, statusError, statusInfo, type StatusCallback } from "../../status";

type UseSWKConnectionParams = {
  paymentRequirement: PaymentRequirements;
  onStatus: StatusCallback;
};

type UseSWKConnectionReturn = {
  kit: StellarWalletsKit | null;
  swkWallet: ISupportedWallet | null;
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

/**
 * Manages Stellar Wallet Kit connection state.
 *
 * @param params - Hook parameters.
 * @param params.paymentRequirement - Payment requirement containing network info.
 * @param params.onStatus - Callback for status messages.
 * @returns Connection state and methods.
 */
export function useSWKConnection({
  paymentRequirement,
  onStatus,
}: UseSWKConnectionParams): UseSWKConnectionReturn {
  const [kit, setKit] = useState<StellarWalletsKit | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [swkWallet, setSwkWallet] = useState<ISupportedWallet | null>(null);

  useEffect(() => {
    const initKit = async () => {
      try {
        const networkPassphrase = getNetworkPassphrase(paymentRequirement.network);
        const newKit = new StellarWalletsKit({
          network: networkPassphrase as WalletNetwork,
          modules: [new KleverModule(), new FreighterModule()], // NOTE: these are the only ones who implement signAuthEntries on SWK v1.9.5
        });

        setKit(newKit);
      } catch (error) {
        console.error("Failed to initialize Stellar Wallet Kit", error);
        onStatus(
          statusError(
            error instanceof Error ? error.message : "Failed to initialize Stellar Wallet Kit.",
          ),
        );
      }
    };

    void initKit();
  }, [paymentRequirement.network, onStatus]);

  const connect = useCallback(async () => {
    if (!kit) {
      onStatus(statusError("Wallet kit is not ready."));
      return;
    }

    try {
      await kit.openModal({
        onWalletSelected: async (wallet: ISupportedWallet) => {
          onStatus(statusInfo("Connecting to wallet..."));

          kit.setWallet(wallet.id);

          const addressResult = await kit.getAddress();
          if (!addressResult.address) {
            throw new Error("Failed to get wallet address.");
          }

          const { networkPassphrase: swkNetworkPassphrase } = await kit.getNetwork();
          if (!swkNetworkPassphrase) {
            throw new Error("Failed to get SWK's wallet network passphrase.");
          }

          const desiredNetworkPassphrase = getNetworkPassphrase(paymentRequirement.network);
          if (swkNetworkPassphrase !== desiredNetworkPassphrase) {
            const networkName = paymentRequirement.network === "stellar" ? "Mainnet" : "Testnet";
            throw new Error(`Please switch your wallet to ${networkName} network, then try again.`);
          }

          setSwkWallet(wallet);
          setAddress(addressResult.address);
          onStatus(statusClear());
        },
        onClosed: () => {
          console.log("===> SWK wallet closed");
        },
      });
    } catch (error) {
      console.error("Failed to connect wallet", error);
      onStatus(
        statusError(error instanceof Error ? error.message : "Failed to connect to wallet."),
      );
      setAddress(null);
      setSwkWallet(null);
    }
  }, [kit, paymentRequirement, onStatus]);

  const disconnect = useCallback(async () => {
    if (kit) {
      try {
        await kit.disconnect();
      } catch (error) {
        console.error("Failed to disconnect wallet", error);
      }
    }
    setAddress(null);
    setSwkWallet(null);
  }, [kit]);

  return {
    kit,
    swkWallet,
    address,
    connect,
    disconnect,
  };
}
