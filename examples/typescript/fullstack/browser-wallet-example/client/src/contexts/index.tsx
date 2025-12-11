import React, { useContext } from "react";
import type { WalletClient } from "viem";
import {
  type Network,
  Signer,
  SupportedEVMNetworks,
  SupportedStellarNetworks,
} from "x402/types";
import { EvmWalletContext, EvmWalletProvider } from "./EvmWalletContext";
import {
  StellarWalletContext,
  StellarWalletProvider,
} from "./StellarWalletContext";

export interface WalletContextType {
  type: "evm" | "stellar";
  isConnected: boolean;
  address: string | null;
  walletClient: WalletClient | Signer | null;
  error: string | null;
  isConnecting: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
}

const network = (import.meta.env.NETWORK as Network) || "base-sepolia";
const isEvmNetwork = SupportedEVMNetworks.includes(network);
const isStellarNetwork = SupportedStellarNetworks.includes(network);

/**
 * Gets the appropriate wallet context based on the current network configuration.
 * @returns The wallet context for the current network type
 * @throws {Error} When the network is unsupported
 */
function getWalletContext() {
  if (isEvmNetwork) {
    return EvmWalletContext;
  }
  if (isStellarNetwork) {
    return StellarWalletContext;
  }
  const evmNetworks = SupportedEVMNetworks.join(", ");
  const stellarNetworks = SupportedStellarNetworks.join(", ");
  throw new Error(
    `Unsupported network: ${network}. Supported networks are EVM (${evmNetworks}) and Stellar (${stellarNetworks})`
  );
}

/**
 * Hook to access wallet functionality and state.
 * Provides wallet connection status, address, client instance, and connection methods.
 * @returns The wallet context containing connection state and methods
 * @throws {Error} When used outside of a WalletProvider
 */
export function useWallet(): WalletContextType {
  const context = useContext(getWalletContext());
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}

/**
 * Provider component that wraps the application with wallet context.
 * Automatically selects the appropriate wallet provider based on the configured network.
 * @param props - The component props
 * @param props.children - Child components to wrap with wallet context
 * @returns The appropriate wallet provider component
 * @throws {Error} When the network is unsupported or Stellar networks are not yet implemented
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  if (isEvmNetwork) {
    return <EvmWalletProvider>{children}</EvmWalletProvider>;
  }
  if (isStellarNetwork) {
    return <StellarWalletProvider>{children}</StellarWalletProvider>;
  }

  const evmNetworks = SupportedEVMNetworks.join(", ");
  const stellarNetworks = SupportedStellarNetworks.join(", ");
  throw new Error(
    `Unsupported network: ${network}. Supported networks are EVM (${evmNetworks}) and Stellar (${stellarNetworks})`
  );
}
