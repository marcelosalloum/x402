import { useCallback, useEffect, useState } from "react";
import {
  getAddress,
  getNetwork,
  isAllowed,
  isConnected,
  requestAccess,
} from "@stellar/freighter-api";

import type { PaymentRequirements } from "../../../../types/verify";
import { statusClear, statusError, statusInfo, type StatusCallback } from "../../status";

type UseFreighterConnectionParams = {
  paymentRequirement: PaymentRequirements;
  onStatus: StatusCallback;
};

type UseFreighterConnectionReturn = {
  isInstalled: boolean | null;
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
};

const NETWORK_NAME_MAP = new Map<string, string>([
  ["PUBLIC", "Mainnet"],
  ["TESTNET", "Testnet"],
  ["stellar", "Mainnet"],
  ["stellar-testnet", "Testnet"],
]);

/**
 * Manages Freighter wallet connection state.
 *
 * @param params - Hook parameters.
 * @param params.paymentRequirement - Payment requirement containing network info.
 * @param params.onStatus - Callback for status messages.
 * @returns Connection state and methods.
 */
export function useFreighterConnection({
  paymentRequirement,
  onStatus,
}: UseFreighterConnectionParams): UseFreighterConnectionReturn {
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);

  const [address, setAddress] = useState<string | null>(null);

  /**
   * Handles errors if needed.
   *
   * @param error - The error to handle.
   */
  const handleErrorIfNeeded = (error?: Error) => {
    if (error) {
      onStatus(statusError(error.message));
    }
  };

  /**
   * Checks if the Freighter wallet is connected and allowed to access the app.
   */
  const checkConnection = useCallback(async () => {
    const isAppConnected = await isConnected();
    if (!isAppConnected.isConnected) {
      setIsInstalled(false);
      setAddress(null);
      handleErrorIfNeeded(isAppConnected.error);
      return;
    }

    setIsInstalled(true);
    const isAppAllowed = await isAllowed();
    if (!isAppAllowed.isAllowed) {
      setAddress(null);
      handleErrorIfNeeded(isAppAllowed.error);
      return;
    }

    const appNetwork = await getNetwork();
    if (!appNetwork.network) {
      setAddress(null);
      handleErrorIfNeeded(appNetwork.error);
      return;
    }

    const appAddress = await getAddress();
    if (!appAddress.address) {
      setAddress(null);
      handleErrorIfNeeded(appAddress.error);
      return;
    }

    setAddress(appAddress.address);
  }, []);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  const connect = useCallback(async () => {
    try {
      onStatus(statusInfo("Connecting to Freighter..."));

      // 1. Ensure Freighter is installed
      const connectedResult = await isConnected();
      if (connectedResult.error || !connectedResult.isConnected) {
        throw new Error("Freighter wallet is not installed or not available.", {
          cause: connectedResult.error,
        });
      }

      // 2. Ensure the correct network is selected
      const networkResult = await getNetwork();
      if (networkResult.error || !networkResult.network) {
        throw new Error("Failed to get network information from Freighter.", {
          cause: networkResult.error,
        });
      }

      // Standardize the network name from either x402 (stellar, stellar-testnet) or Freighter (PUBLIC, TESTNET) to a human-readable network name (Mainnet, Testnet)
      const currentNetwork = NETWORK_NAME_MAP.get(networkResult.network);
      const requiredNetwork = NETWORK_NAME_MAP.get(paymentRequirement.network);

      if (currentNetwork !== requiredNetwork) {
        throw new Error(
          `Please switch Freighter to ${requiredNetwork} network (currently on ${currentNetwork}), then try again.`,
        );
      }

      // 3. Request access to the app
      const accessResult = await requestAccess();
      if (accessResult.error || !accessResult.address) {
        throw new Error(accessResult.error || "Failed to connect to Freighter.");
      }

      // 4. Verify the network is still the correct one
      const finalNetworkResult = await getNetwork();
      if (finalNetworkResult.error) {
        throw new Error("Failed to verify network information.");
      }

      const finalNetwork = NETWORK_NAME_MAP.get(finalNetworkResult.network);
      if (finalNetwork !== requiredNetwork) {
        throw new Error(
          `Network mismatch: Please switch Freighter to ${requiredNetwork} network to continue.`,
        );
      }

      setAddress(accessResult.address);
      onStatus(statusClear());
    } catch (error) {
      console.error("Failed to connect Freighter", error);
      onStatus(
        statusError(error instanceof Error ? error.message : "Failed to connect to Freighter."),
      );
      setAddress(null);
    }
  }, [paymentRequirement, onStatus]);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  return {
    isInstalled,
    address,
    connect,
    disconnect,
  };
}
