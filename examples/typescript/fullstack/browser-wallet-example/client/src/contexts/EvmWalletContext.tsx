import React, { createContext, useState, useCallback, useEffect } from "react";
import {
  createWalletClient as createEvmWalletClient,
  custom as customEvmTransporter,
  type WalletClient as EvmWalletClient,
  type Hex,
} from "viem";
import { SupportedEVMNetworks, type Network, evm } from "x402/types";
import type { WalletContextType } from ".";

export const EvmWalletContext = createContext<WalletContextType | undefined>(
  undefined
);

export function EvmWalletProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<Hex | null>(null);
  const [walletClient, setWalletClient] = useState<EvmWalletClient | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const network = (import.meta.env.NETWORK as Network) || "base-sepolia";
  const isEvmNetwork = SupportedEVMNetworks.includes(network);

  // Check if wallet is already connected on mount
  useEffect(() => {
    checkEvmConnection();
  }, []);

  const checkEvmConnection = async () => {
    if (typeof window.ethereum !== "undefined") {
      try {
        const accounts = (await window.ethereum.request({
          method: "eth_accounts",
        })) as string[];

        if (accounts.length > 0) {
          const client = createEvmWalletClient({
            account: accounts[0] as Hex,
            chain: evm.getChainFromNetwork(network as string),
            transport: customEvmTransporter(window.ethereum),
          });

          setWalletClient(client);
          setAddress(accounts[0] as Hex);
          setIsConnected(true);
        }
      } catch (err) {
        console.error("Failed to check wallet connection:", err);
      }
    }
  };

  const connectEvmWallet = useCallback(async () => {
    if (!isEvmNetwork) {
      setError(`Network ${network} is not an EVM-compatible network`);
      return;
    }
    setError(null);
    setIsConnecting(true);

    try {
      if (typeof window.ethereum === "undefined") {
        throw new Error("Please install MetaMask or another Ethereum wallet");
      }

      // Request account access
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];

      if (accounts.length === 0) {
        throw new Error("No accounts found");
      }

      // Check if on correct network
      const chainId = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;

      const evmChain = evm.getChainFromNetwork(network as string);
      const expectedChainIdHex = `0x${evmChain.id.toString(16)}`;
      if (chainId !== expectedChainIdHex) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: expectedChainIdHex }],
          });
        } catch (switchError: any) {
          // This error code indicates that the chain has not been added to browser wallet
          if (switchError.code === 4902) {
            // If the chain is not in the user's wallet, request to add it
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: expectedChainIdHex,
                  chainName: network,
                  nativeCurrency: {
                    name: "Ethereum",
                    symbol: "ETH",
                    decimals: 18,
                  },
                  rpcUrls: [evmChain.rpcUrls.default.http[0]],
                  blockExplorerUrls: [evmChain.blockExplorers?.default.url],
                },
              ],
            });
          } else {
            throw switchError;
          }
        }
      }

      // Create viem wallet client
      const client = createEvmWalletClient({
        account: accounts[0] as Hex,
        chain: evm.getChainFromNetwork(network as string),
        transport: customEvmTransporter(window.ethereum),
      });

      setWalletClient(client);
      setAddress(accounts[0] as Hex);
      setIsConnected(true);
    } catch (err: any) {
      setError(err.message || "Failed to connect wallet");
      console.error("Wallet connection error:", err);
    } finally {
      setIsConnecting(false);
    }
  }, [network, isEvmNetwork]);

  const disconnectEvmWallet = useCallback(async () => {
    if (typeof window.ethereum !== "undefined") {
      try {
        await window.ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
        setError(null);
      } catch (err) {
        setError(
          "Failed to revoke wallet permissions:" + (err as Error).message
        );
        console.error("Failed to revoke wallet permissions:", err);
      }
    } else {
      setError(null);
    }

    setWalletClient(null);
    setAddress(null);
    setIsConnected(false);
  }, []);

  // Listen for account changes
  useEffect(() => {
    if (typeof window.ethereum !== "undefined") {
      const handleAccountsChanged = async (accounts: string[]) => {
        if (accounts.length === 0) {
          await disconnectEvmWallet();
        } else if (accounts[0] !== address) {
          // Re-connect with new account
          const client = createEvmWalletClient({
            account: accounts[0] as Hex,
            chain: evm.getChainFromNetwork(network as string),
            transport: customEvmTransporter(window.ethereum!),
          });

          setWalletClient(client);
          setAddress(accounts[0] as Hex);
          setIsConnected(true);
        }
      };

      const handleChainChanged = () => {
        window.location.reload();
      };

      window.ethereum.on("accountsChanged", handleAccountsChanged);
      window.ethereum.on("chainChanged", handleChainChanged);

      return () => {
        window.ethereum?.removeListener(
          "accountsChanged",
          handleAccountsChanged
        );
        window.ethereum?.removeListener("chainChanged", handleChainChanged);
      };
    }
  }, [address, disconnectEvmWallet]);

  const evmWalletContextValue: WalletContextType = {
    type: "evm",
    isConnected,
    address,
    walletClient,
    error,
    isConnecting,
    connectWallet: connectEvmWallet,
    disconnectWallet: disconnectEvmWallet,
  };

  return (
    <EvmWalletContext.Provider value={evmWalletContextValue}>
      {children}
    </EvmWalletContext.Provider>
  );
}
