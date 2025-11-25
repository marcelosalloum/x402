import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { getNetworkPassphrase, getRpcUrl } from "../../../shared/stellar";
import type { PaymentRequirements } from "../../../types/verify";
import { statusError, type StatusCallback } from "../status";

type UseBalanceParams = {
  address: string | null;
  paymentRequirement: PaymentRequirements;
  onStatus: StatusCallback;
};

type UseBalanceReturn = {
  isFetchingBalance: boolean;
  tokenBalanceRaw: bigint | null;
  tokenBalanceFormatted: string;
  refreshBalance: () => Promise<void>;
  resetBalance: () => void;
};

/**
 * Tracks and refreshes the Stellar USDC balance for the active account.
 *
 * @param params - Hook parameters containing account details and callbacks.
 * @param params.address - Wallet address whose balance is being tracked.
 * @param params.paymentRequirement - Payment requirement describing the asset to monitor.
 * @param params.onStatus - Callback for reporting status messages to the UI.
 * @returns Balance state and helper methods for refreshing/resetting data.
 */
export function useStellarBalance({
  address,
  paymentRequirement,
  onStatus,
}: UseBalanceParams): UseBalanceReturn {
  const [tokenBalanceRaw, setTokenBalanceRaw] = useState<bigint | null>(null);
  const [tokenBalanceFormatted, setTokenBalanceFormatted] = useState<string>("");
  const [isFetchingBalance, setIsFetchingBalance] = useState(false);

  const resetBalance = useCallback(() => {
    setTokenBalanceRaw(null);
    setTokenBalanceFormatted("");
  }, []);

  const refreshBalance = useCallback(async (): Promise<void> => {
    if (!address) {
      resetBalance();
      return;
    }

    setIsFetchingBalance(true);

    try {
      const networkPassphrase = getNetworkPassphrase(paymentRequirement.network);
      const rpcUrl = getRpcUrl(paymentRequirement.network);
      const contractId = paymentRequirement.asset;

      // 1. Simulate to fetch the balance:
      const balanceTx = await AssembledTransaction.build({
        contractId,
        method: "balance",
        args: [nativeToScVal(address, { type: "address" })],
        networkPassphrase,
        rpcUrl,
        parseResultXdr: result => result,
      });
      await balanceTx.simulate();
      if (!balanceTx.result) {
        throw new Error("Balance simulation failed");
      }

      const balanceRaw = scValToNative(balanceTx.result) as bigint;

      // 2. Simulate to get the decimals:
      const decimalsTx = await AssembledTransaction.build({
        contractId,
        method: "decimals",
        networkPassphrase,
        rpcUrl,
        parseResultXdr: result => result,
      });
      await decimalsTx.simulate();
      if (!decimalsTx.result) {
        throw new Error("Decimals simulation failed");
      }
      const decimals = scValToNative(decimalsTx.result) as number;

      // 3. Format the balance:
      const balanceFormatted = formatUnits(balanceRaw, decimals);

      setTokenBalanceRaw(balanceRaw);
      setTokenBalanceFormatted(balanceFormatted);
    } catch (error) {
      console.error("Failed to fetch Stellar USDC balance", error);
      onStatus(
        statusError(
          error instanceof Error ? error.message : "Unable to read your balance. Please retry.",
        ),
      );
      resetBalance();
    } finally {
      setIsFetchingBalance(false);
    }
  }, [address, paymentRequirement, onStatus, resetBalance]);

  useEffect(() => {
    if (address) {
      void refreshBalance();
    }
  }, [address, refreshBalance]);

  return {
    isFetchingBalance,
    tokenBalanceRaw,
    tokenBalanceFormatted,
    refreshBalance,
    resetBalance,
  };
}
