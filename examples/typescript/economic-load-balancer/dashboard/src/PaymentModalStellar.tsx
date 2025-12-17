import { useCallback, useEffect, useState } from "react";
import type { PaymentRequirements, Network } from "x402/types";
import {
  useSWKConnection,
  useSWKSigner,
  useStellarPayment,
  useStellarBalance,
} from "x402/paywall/stellar";
import {
  convertAtomicToUsdc,
  createPaymentSuccessMessage,
  createPaymentFailureMessage,
  createWalletConnectionMessage,
} from "./utils";

// ============================================================================
// Types
// ============================================================================

type PaymentStatus =
  | "idle"
  | "connecting"
  | "checking-balance"
  | "paying"
  | "success"
  | "error";

interface PaymentModalStellarProps {
  paymentRequirement: PaymentRequirements;
  serverUrl: string;
  endpointPath: string;
  onSuccess: (data: unknown) => void;
  onClose: () => void;
  onLog?: (message: string, type?: "info" | "success" | "error") => void;
}

// ============================================================================
// Component
// ============================================================================

export function PaymentModalStellar({
  paymentRequirement,
  serverUrl,
  endpointPath,
  onSuccess,
  onClose,
  onLog,
}: PaymentModalStellarProps) {
  const network = paymentRequirement.network as Network;
  const amount = convertAtomicToUsdc(
    paymentRequirement.maxAmountRequired,
    network
  );

  // Local state
  const [status, setStatus] = useState<string>("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("idle");
  const [error, setError] = useState<string>("");

  // Memoize status handler to prevent infinite loops in useStellarBalance
  const handleStatus = useCallback((s: { message: string } | null) => {
    setStatus(s?.message || "");
  }, []);

  // Stellar wallet hooks
  const { kit, swkWallet, address, connect, disconnect } = useSWKConnection({
    network,
    onStatus: handleStatus,
  });

  const walletSigner = useSWKSigner({
    kit,
    swkWallet,
    network,
    address,
  });

  const { tokenBalanceFormatted, refreshBalance } = useStellarBalance({
    address,
    network,
    asset:
      typeof paymentRequirement.asset === "string"
        ? paymentRequirement.asset
        : "USDC",
    onStatus: handleStatus,
  });

  const { isPaying, submitPayment } = useStellarPayment({
    x402: {
      currentUrl: `${serverUrl}${endpointPath}`,
      amount,
      testnet: network === "stellar-testnet",
    } as any,
    paymentRequirement,
    walletSigner,
    onSuccessfulResponse: async (response: Response) => {
      const data = await response.json();
      setPaymentStatus("success");
      onSuccess(data);
    },
    setStatus: handleStatus,
  });

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Auto-trigger balance check and log connection when wallet connects
   */
  const [hasCheckedBalance, setHasCheckedBalance] = useState(false);

  useEffect(() => {
    if (address && !hasCheckedBalance) {
      setHasCheckedBalance(true);
      setPaymentStatus("checking-balance");
      setStatus("Loading balance...");

      // Log wallet connection
      if (onLog) {
        const message = createWalletConnectionMessage(address, network);
        onLog(message, "success");
      }

      refreshBalance()
        .then(() => {
          setPaymentStatus("idle");
          setStatus("Wallet connected! Ready to pay.");
        })
        .catch((err) => {
          setPaymentStatus("idle");
          setStatus("Balance check failed, but you can still try to pay.");
          console.error("Balance check error:", err);
        });
    }
  }, [address, hasCheckedBalance, refreshBalance, network, onLog]);

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleConnectClick = useCallback(async () => {
    setPaymentStatus("connecting");
    setError("");
    setStatus("Opening wallet selector...");

    try {
      await connect();
      setStatus("Wallet connected successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
      setPaymentStatus("idle");
      setStatus("");
    }
  }, [connect]);

  const handleStellarPayment = useCallback(async () => {
    if (!address || !walletSigner) {
      setError("Please connect your Stellar wallet first");
      return;
    }

    setError("");
    setPaymentStatus("checking-balance");
    setStatus("Checking balance...");

    try {
      await refreshBalance();

      // Verify sufficient balance
      if (tokenBalanceFormatted && Number(tokenBalanceFormatted) < amount) {
        setError(
          `Insufficient balance. You have $${tokenBalanceFormatted} USDC, need $${amount.toFixed(
            6
          )}`
        );
        setPaymentStatus("error");
        setStatus("");
        return;
      }

      setPaymentStatus("paying");
      setStatus("Processing payment...");

      // Log payment start
      if (onLog) {
        onLog(
          `Payment of $${amount.toFixed(6)} USDC started for ${network}`,
          "info"
        );
      }

      await submitPayment();

      // Log payment success
      if (onLog) {
        const message = createPaymentSuccessMessage(amount, network, address);
        onLog(message, "success");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Payment failed";
      setError(errorMessage);
      setPaymentStatus("error");
      setStatus("");

      // Log payment failure
      if (onLog) {
        const message = createPaymentFailureMessage(
          amount,
          network,
          address,
          errorMessage
        );
        onLog(message, "error");
      }
    }
  }, [
    address,
    walletSigner,
    tokenBalanceFormatted,
    amount,
    refreshBalance,
    submitPayment,
    network,
    onLog,
  ]);

  // ============================================================================
  // Render
  // ============================================================================

  const handleOverlayClick = useCallback(() => {
    // Don't allow closing during connection or payment
    if (
      paymentStatus !== "connecting" &&
      paymentStatus !== "paying" &&
      paymentStatus !== "checking-balance"
    ) {
      onClose();
    }
  }, [paymentStatus, onClose]);

  return (
    <div className="payment-modal-overlay" onClick={handleOverlayClick}>
      <div className="payment-modal" onClick={(e) => e.stopPropagation()}>
        <div className="payment-modal-header">
          <h2>Complete Payment</h2>
          <button
            className="payment-modal-close"
            onClick={onClose}
            disabled={
              paymentStatus === "paying" || paymentStatus === "checking-balance"
            }
          >
            ×
          </button>
        </div>

        <div className="payment-modal-content">
          <div className="payment-info">
            <p>
              <strong>Network:</strong> {network}
            </p>
            <p>
              <strong>Amount:</strong> ${amount.toFixed(6)} USDC
            </p>
            {address && (
              <p>
                <strong>Wallet:</strong> {address.slice(0, 6)}...
                {address.slice(-4)}
              </p>
            )}
            {tokenBalanceFormatted && (
              <p>
                <strong>Balance:</strong> ${tokenBalanceFormatted} USDC
              </p>
            )}
          </div>

          {!address ? (
            <div className="payment-connect">
              <button
                className="button button-primary"
                onClick={handleConnectClick}
                disabled={!kit || paymentStatus === "connecting"}
              >
                {!kit
                  ? "Loading wallet options..."
                  : paymentStatus === "connecting"
                  ? "Connecting..."
                  : "Connect Stellar Wallet"}
              </button>
            </div>
          ) : (
            <div className="payment-actions">
              <button className="button button-secondary" onClick={disconnect}>
                Disconnect
              </button>
              <button
                className="button button-primary"
                onClick={handleStellarPayment}
                disabled={
                  paymentStatus === "paying" ||
                  paymentStatus === "checking-balance" ||
                  isPaying
                }
              >
                {paymentStatus === "paying" || isPaying
                  ? "Processing..."
                  : paymentStatus === "checking-balance"
                  ? "Checking..."
                  : "Pay Now"}
              </button>
            </div>
          )}

          {status && <div className="payment-status">{status}</div>}

          {error && <div className="payment-error">{error}</div>}

          {paymentStatus === "success" && (
            <div className="payment-success">
              ✅ Payment successful! Resource unlocked.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
