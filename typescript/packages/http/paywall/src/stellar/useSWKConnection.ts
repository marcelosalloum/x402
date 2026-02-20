import { useCallback, useEffect, useRef, useState } from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  HotWalletModule,
  HanaModule,
  KleverModule,
} from "@creit.tech/stellar-wallets-kit";
import type { ISupportedWallet } from "@creit.tech/stellar-wallets-kit";

import type { Network } from "@x402/core/types";
import { getNetworkPassphrase } from "@x402/stellar";
import { statusClear, statusError, statusInfo, type Status } from "../status";

export type UseSWKConnectionParams = {
  network: Network;
  onStatus: (status: Status | null) => void;
};

export type UseSWKConnectionReturn = {
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
 * @param params.network - Network to connect to (CAIP-2 format).
 * @param params.onStatus - Callback for status messages.
 * @returns Connection state and methods.
 */
export function useSWKConnection({
  network,
  onStatus,
}: UseSWKConnectionParams): UseSWKConnectionReturn {
  const [kit, setKit] = useState<StellarWalletsKit | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [swkWallet, setSwkWallet] = useState<ISupportedWallet | null>(null);
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onStatusRef.current = onStatus;
  });

  useEffect(() => {
    const initKit = async () => {
      try {
        const networkPassphrase = getNetworkPassphrase(network);
        const newKit = new StellarWalletsKit({
          network: networkPassphrase as WalletNetwork,
          // These are the only modules that implement signAuthEntries on SWK 2 (beta)
          modules: [
            new FreighterModule(),
            new HotWalletModule(),
            new HanaModule(),
            new KleverModule(),
          ],
        });

        setKit(newKit);
      } catch (error) {
        console.error("Failed to initialize Stellar Wallet Kit", error);
        onStatusRef.current(
          statusError(
            error instanceof Error ? error.message : "Failed to initialize Stellar Wallet Kit.",
          ),
        );
      }
    };

    void initKit();
  }, [network]);

  const connect = useCallback(async () => {
    if (!kit) {
      onStatusRef.current(statusError("Wallet kit is not ready."));
      return;
    }

    try {
      await kit.openModal({
        onWalletSelected: async (wallet: ISupportedWallet) => {
          onStatusRef.current(statusInfo("Connecting to wallet..."));

          kit.setWallet(wallet.id);

          const addressResult = await kit.getAddress();
          if (!addressResult.address) {
            throw new Error("Failed to get wallet address.");
          }

          const { networkPassphrase: swkNetworkPassphrase } = await kit.getNetwork();
          if (!swkNetworkPassphrase) {
            throw new Error("Failed to get SWK's wallet network passphrase.");
          }

          const desiredNetworkPassphrase = getNetworkPassphrase(network);
          if (swkNetworkPassphrase !== desiredNetworkPassphrase) {
            const networkName = network === "stellar:pubnet" ? "Mainnet" : "Testnet";
            throw new Error(`Please switch your wallet to ${networkName} network, then try again.`);
          }

          setSwkWallet(wallet);
          setAddress(addressResult.address);
          onStatusRef.current(statusClear());
        },
        onClosed: () => {
          console.log("===> SWK wallet closed");
        },
      });
    } catch (error) {
      console.error("Failed to connect wallet", error);
      onStatusRef.current(
        statusError(error instanceof Error ? error.message : "Failed to connect to wallet."),
      );
      setAddress(null);
      setSwkWallet(null);
    }
  }, [kit, network]);

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
