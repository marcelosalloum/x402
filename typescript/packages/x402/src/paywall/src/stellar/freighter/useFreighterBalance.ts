import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { getNetworkPassphrase, getRpcUrl } from "../../../../shared/stellar";
import type { PaymentRequirements } from "../../../../types/verify";
import { statusError, type StatusCallback } from "../../status";

type UseFreighterBalanceParams = {
  address: string | null;
  paymentRequirement: PaymentRequirements;
  onStatus: StatusCallback;
};

type UseFreighterBalanceReturn = {
  usdcBalance: bigint | null;
  formattedBalance: string;
  isFetchingBalance: boolean;
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
export function useFreighterBalance({
  address,
  paymentRequirement,
  onStatus,
}: UseFreighterBalanceParams): UseFreighterBalanceReturn {
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [formattedBalance, setFormattedBalance] = useState<string>("");
  const [isFetchingBalance, setIsFetchingBalance] = useState(false);

  const resetBalance = useCallback(() => {
    setUsdcBalance(null);
    setFormattedBalance("");
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

      const balance = scValToNative(balanceTx.result) as bigint;
      const decimals = 7;
      const displayBalance = formatUnits(balance, decimals);

      setUsdcBalance(balance);
      setFormattedBalance(displayBalance);
    } catch (error) {
      console.error("Failed to fetch Stellar USDC balance", error);
      onStatus(statusError("Unable to read your USDC balance. Please retry."));
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
    usdcBalance,
    formattedBalance,
    isFetchingBalance,
    refreshBalance,
    resetBalance,
  };
}
