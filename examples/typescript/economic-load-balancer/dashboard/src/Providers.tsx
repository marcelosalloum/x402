import { OnchainKitProvider } from "@coinbase/onchainkit";
import type { ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { coinbaseWallet, metaMask, walletConnect } from "wagmi/connectors";

const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [
    coinbaseWallet({
      appName: "x402 Economic Load Balancer",
      preference: "all",
    }),
    metaMask({
      dappMetadata: {
        name: "x402 Economic Load Balancer",
      },
    }),
    walletConnect({
      projectId: "3fbb6bba6f1de962d911bb5b5c9dba88", // Public WalletConnect project ID
    }),
  ],
  transports: {
    [baseSepolia.id]: http(),
  },
  ssr: false,
});

const queryClient = new QueryClient();

type ProvidersProps = {
  children: ReactNode;
};

/**
 * Providers component for wallet connections
 * Sets up OnchainKit and Wagmi for EVM wallet support
 */
export function Providers({ children }: ProvidersProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <OnchainKitProvider
          chain={baseSepolia}
          config={{
            appearance: {
              mode: "dark",
              theme: "base",
            },
            wallet: {
              display: "modal",
            },
          }}
        >
          {children}
        </OnchainKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

