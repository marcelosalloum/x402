import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { baseSepolia } from "viem/chains";
import { createPublicClient, formatUnits, http, publicActions } from "viem";
import { exact } from "x402/schemes";
import { getUSDCBalance } from "x402/shared/evm";
import type { PaymentRequirements } from "x402/types";
import {
  convertAtomicToUsdc,
  createPaymentSuccessMessage,
  createPaymentFailureMessage,
  createWalletConnectionMessage,
} from "./utils";

// ============================================================================
// Types
// ============================================================================

type PaymentStatus = "idle" | "connecting" | "checking-balance" | "paying" | "success" | "error";

interface PaymentModalEvmProps {
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

export function PaymentModalEvm({
  paymentRequirement,
  serverUrl,
  endpointPath,
  onSuccess,
  onClose,
  onLog,
}: PaymentModalEvmProps) {
  const network = paymentRequirement.network;
  const amount = convertAtomicToUsdc(paymentRequirement.maxAmountRequired, network);

  // Wagmi hooks
  const { address, isConnected, chainId: connectedChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: wagmiWalletClient } = useWalletClient();
  const { disconnect } = useDisconnect();
  const { connectors, connect: wagmiConnect, isPending: isConnecting } = useConnect();

  // Local state
  const [balance, setBalance] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("idle");
  const [error, setError] = useState<string>("");
  const [isCorrectChain, setIsCorrectChain] = useState<boolean | null>(null);
  
  // Refs
  const hasLoggedConnection = useRef(false);

  // Setup blockchain client
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  }).extend(publicActions);

  const usdcAddress =
    typeof paymentRequirement.asset === "string"
      ? (paymentRequirement.asset as `0x${string}`)
      : (paymentRequirement.asset.asset as `0x${string}`);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Check and display USDC balance when wallet connects
   */
  useEffect(() => {
    const checkBalance = async () => {
      if (!address) return;

      try {
        const bal = await getUSDCBalance(publicClient, address as `0x${string}`, usdcAddress);
        const balanceNum = parseFloat(formatUnits(bal, 6));
        setBalance(balanceNum.toFixed(6));
      } catch (err) {
        console.error("Failed to check balance:", err);
      }
    };

    checkBalance();
  }, [address, publicClient, usdcAddress]);

  /**
   * Verify user is on the correct blockchain network
   */
  useEffect(() => {
    if (isConnected && baseSepolia.id === connectedChainId) {
      setIsCorrectChain(true);
      setStatus("");
    } else if (isConnected && baseSepolia.id !== connectedChainId) {
      setIsCorrectChain(false);
      setStatus("On the wrong network. Please switch to Base Sepolia.");
    } else {
      setIsCorrectChain(null);
      setStatus("");
    }
  }, [baseSepolia.id, connectedChainId, isConnected]);

  /**
   * Log wallet connection (only once per modal instance)
   */
  useEffect(() => {
    if (address && onLog && !hasLoggedConnection.current) {
      hasLoggedConnection.current = true;
      const message = createWalletConnectionMessage(address, network);
      onLog(message, "success");
    }
  }, [address, network, onLog]);

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleConnectWallet = useCallback(
    (connector: (typeof connectors)[0]) => {
      try {
        setError("");
        wagmiConnect({ connector });
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to connect wallet");
      }
    },
    [wagmiConnect]
  );

  const handleSwitchChain = useCallback(async () => {
    if (isCorrectChain) return;

    try {
      setStatus("Switching to Base Sepolia...");
      await switchChainAsync({ chainId: baseSepolia.id });
      await new Promise((resolve) => setTimeout(resolve, 100));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to switch network");
    }
  }, [switchChainAsync, isCorrectChain]);

  const handleEvmPayment = useCallback(async () => {
    if (!address || !wagmiWalletClient) {
      setError("Please connect your EVM wallet first");
      return;
    }

    try {
      setError("");
      setPaymentStatus("checking-balance");
      setStatus("Checking balance...");

      // Switch chain if needed
      await handleSwitchChain();

      // Extend wallet client with publicActions
      const walletClient = wagmiWalletClient.extend(publicActions);

      // Verify sufficient balance
      const bal = await getUSDCBalance(publicClient, address as `0x${string}`, usdcAddress);
      const balanceNum = parseFloat(formatUnits(bal, 6));
      setBalance(balanceNum.toFixed(6));

      if (bal === 0n) {
        throw new Error(`Insufficient balance. Make sure you have USDC on Base Sepolia`);
      }

      if (balanceNum < amount) {
        setError(
          `Insufficient balance. You have $${balanceNum.toFixed(6)} USDC, need $${amount.toFixed(6)}`
        );
        setPaymentStatus("error");
        return;
      }

      // Create and submit payment
      setPaymentStatus("paying");
      setStatus("Creating payment signature...");

      if (onLog) {
        onLog(`Payment of $${amount.toFixed(6)} USDC started for ${network}`, "info");
      }

      const initialPayment = await exact.evm.createPayment(
        walletClient,
        1,
        paymentRequirement
      );
      const paymentHeader: string = exact.evm.encodePayment(initialPayment);

      setStatus("Requesting content with payment...");

      // Submit payment
      const response = await fetch(`${serverUrl}${endpointPath}`, {
        headers: {
          "X-PAYMENT": paymentHeader,
          "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
        },
      });

      if (response.ok) {
        await handlePaymentSuccess(response);
        return;
      }

      if (response.status === 402) {
        await handlePaymentRetry(response, walletClient);
        return;
      }

      throw await parseErrorResponse(response);
    } catch (err) {
      handlePaymentError(err);
    }
  }, [
    address,
    wagmiWalletClient,
    paymentRequirement,
    amount,
    serverUrl,
    endpointPath,
    onSuccess,
    handleSwitchChain,
    publicClient,
    usdcAddress,
    network,
    onLog,
  ]);

  /**
   * Handle successful payment response
   */
  const handlePaymentSuccess = async (response: Response) => {
    const data = await response.json();
    setPaymentStatus("success");
    setStatus("Payment successful!");

    if (onLog && address) {
      const message = createPaymentSuccessMessage(amount, network, address);
      onLog(message, "success");
    }

    onSuccess(data);
  };

  /**
   * Handle payment retry with version mismatch
   */
  const handlePaymentRetry = async (response: Response, walletClient: any) => {
    const errorData = await response.json().catch(() => ({}));

    // Check for undeployed smart wallet error
    if (errorData.error === "invalid_exact_evm_payload_undeployed_smart_wallet") {
      throw new Error(
        "Smart wallet must be deployed before making payments. Please deploy your wallet first."
      );
    }

    // Retry with correct version if provided
    if (errorData && typeof errorData.x402Version === "number") {
      setStatus("Retrying payment with correct version...");

      const retryPayment = await exact.evm.createPayment(
        walletClient,
        errorData.x402Version,
        paymentRequirement
      );
      retryPayment.x402Version = errorData.x402Version;
      const retryHeader = exact.evm.encodePayment(retryPayment);

      const retryResponse = await fetch(`${serverUrl}${endpointPath}`, {
        headers: {
          "X-PAYMENT": retryHeader,
          "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
        },
      });

      if (retryResponse.ok) {
        await handlePaymentSuccess(retryResponse);
        return;
      }

      throw new Error(`Payment retry failed: ${retryResponse.statusText}`);
    }

    throw new Error(`Payment failed: ${response.statusText}`);
  };

  /**
   * Parse error response from server
   */
  const parseErrorResponse = async (response: Response): Promise<Error> => {
    let errorMessage = `Request failed: ${response.status} ${response.statusText}`;

    try {
      const errorData = await response.json();
      if (errorData.error) {
        errorMessage = errorData.error;
      } else if (
        errorData.invalidReason === "invalid_exact_evm_payload_undeployed_smart_wallet"
      ) {
        errorMessage =
          "Smart wallet must be deployed before making payments. Please deploy your wallet first.";
      } else if (errorData.invalidReason) {
        errorMessage = `Payment validation failed: ${errorData.invalidReason}`;
      }
    } catch {
      // Use default error message if parsing fails
    }

    return new Error(errorMessage);
  };

  /**
   * Handle payment error
   */
  const handlePaymentError = (err: unknown) => {
    const errorMessage = err instanceof Error ? err.message : "Payment failed";
    setError(errorMessage);
    setPaymentStatus("error");
    setStatus("");

    if (onLog && address) {
      const message = createPaymentFailureMessage(amount, network, address, errorMessage);
      onLog(message, "error");
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  const handleOverlayClick = useCallback(() => {
    if (
      paymentStatus !== "paying" &&
      paymentStatus !== "checking-balance" &&
      paymentStatus !== "connecting"
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
              paymentStatus === "paying" ||
              paymentStatus === "checking-balance"
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
                <strong>Wallet:</strong> {address.slice(0, 6)}...{address.slice(-4)}
              </p>
            )}
            {balance && (
              <p>
                <strong>Balance:</strong> ${balance} USDC
              </p>
            )}
          </div>

          {!isConnected ? (
            <div className="wallet-selection">
              <p className="wallet-selection-title">Select a wallet to connect:</p>
              <div className="wallet-cards">
                {connectors.map((connector) => (
                  <button
                    key={connector.id}
                    className="wallet-card"
                    onClick={() => handleConnectWallet(connector)}
                    disabled={isConnecting}
                  >
                    <div className="wallet-card-icon">
                      {connector.name === "Coinbase Wallet" && "💙"}
                      {connector.name === "MetaMask" && "🦊"}
                      {connector.name === "WalletConnect" && "🔗"}
                    </div>
                    <div className="wallet-card-name">{connector.name}</div>
                  </button>
                ))}
              </div>
              {isConnecting && <p className="wallet-connecting">Connecting...</p>}
            </div>
          ) : (
            <div className="payment-actions">
              <button className="button button-secondary" onClick={() => disconnect()}>
                Disconnect
              </button>
              {isCorrectChain ? (
                <button
                  className="button button-primary"
                  onClick={handleEvmPayment}
                  disabled={
                    paymentStatus === "paying" || paymentStatus === "checking-balance"
                  }
                >
                  {paymentStatus === "paying"
                    ? "Processing..."
                    : paymentStatus === "checking-balance"
                    ? "Checking..."
                    : "Pay Now"}
                </button>
              ) : (
                <button className="button button-primary" onClick={handleSwitchChain}>
                  Switch to Base Sepolia
                </button>
              )}
            </div>
          )}

          {status && <div className="payment-status">{status}</div>}

          {error && <div className="payment-error">{error}</div>}

          {paymentStatus === "success" && (
            <div className="payment-success">✅ Payment successful! Resource unlocked.</div>
          )}
        </div>
      </div>
    </div>
  );
}
