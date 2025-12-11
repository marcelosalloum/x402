import React, {
  createContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import type { Network } from "x402/types";
import { SupportedStellarNetworks } from "x402/types";
import { useSWKConnection, useSWKSigner } from "x402/paywall/stellar";
import { WalletContextType } from ".";

export const StellarWalletContext = createContext<
  WalletContextType | undefined
>(undefined);

export function StellarWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const network = (import.meta.env.NETWORK as Network) || "stellar-testnet";
  const isStellarNetwork = SupportedStellarNetworks.includes(network);

  const handleStatus = useCallback((newStatus: any) => {
    if (newStatus) {
      if (newStatus.type === "error") {
        setError(newStatus.message);
      } else {
        setError(null);
      }
    } else {
      setError(null);
    }
  }, []);

  const {
    kit,
    swkWallet,
    address: swkAddress,
    connect: swkConnect,
    disconnect: swkDisconnect,
  } = useSWKConnection({
    network,
    onStatus: handleStatus,
  });

  const walletSigner = useSWKSigner({
    address: swkAddress,
    network,
    kit,
    swkWallet,
  });

  useEffect(() => {
    if (swkAddress) {
      setAddress(swkAddress);
      setIsConnected(true);
      setError(null);
    } else {
      setAddress(null);
      setIsConnected(false);
    }
  }, [swkAddress]);

  const connectStellarWallet = useCallback(async () => {
    if (!isStellarNetwork) {
      setError(`Network ${network} is not a Stellar-compatible network`);
      return;
    }

    setError(null);
    setIsConnecting(true);

    try {
      await swkConnect();
    } catch (err: any) {
      setError(err.message || "Failed to connect wallet");
      console.error("Wallet connection error:", err);
    } finally {
      setIsConnecting(false);
    }
  }, [network, isStellarNetwork, swkConnect]);

  const disconnectStellarWallet = useCallback(async () => {
    try {
      await swkDisconnect();
      setError(null);
    } catch (err) {
      setError("Failed to disconnect wallet: " + (err as Error).message);
      console.error("Failed to disconnect wallet:", err);
    }

    setAddress(null);
    setIsConnected(false);
  }, [swkDisconnect]);

  const stellarWalletContextValue: WalletContextType = useMemo(
    () => ({
      type: "stellar",
      isConnected,
      address,
      walletClient: walletSigner,
      error,
      isConnecting,
      connectWallet: connectStellarWallet,
      disconnectWallet: disconnectStellarWallet,
    }),
    [
      isConnected,
      address,
      walletSigner,
      error,
      isConnecting,
      connectStellarWallet,
      disconnectStellarWallet,
    ]
  );

  return (
    <StellarWalletContext.Provider value={stellarWalletContextValue}>
      {children}
    </StellarWalletContext.Provider>
  );
}
