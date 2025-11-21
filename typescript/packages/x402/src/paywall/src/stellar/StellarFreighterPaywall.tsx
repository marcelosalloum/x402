import { useCallback, useState } from "react";
import type { PaymentRequirements } from "../../../types/verify";
import { exact } from "../../../schemes";
import { Spinner } from "../Spinner";
import { getNetworkDisplayName } from "../paywallUtils";
import type { Status } from "../status";
import { statusError, statusInfo, statusSuccess } from "../status";
import { useFreighterConnection } from "./freighter/useFreighterConnection";
import { useFreighterBalance } from "./freighter/useFreighterBalance";
import { useFreighterSigner } from "./freighter/useFreighterSigner";

type StellarFreighterPaywallProps = {
  paymentRequirement: PaymentRequirements;
  onSuccessfulResponse: (response: Response) => Promise<void>;
};

/**
 * Paywall experience for Stellar networks using Freighter wallet.
 *
 * @param props - Component props.
 * @param props.paymentRequirement - Payment requirement enforced for Stellar requests.
 * @param props.onSuccessfulResponse - Callback invoked on successful 402 response.
 * @returns JSX element.
 */
export function StellarFreighterPaywall({
  paymentRequirement,
  onSuccessfulResponse,
}: StellarFreighterPaywallProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [hideBalance, setHideBalance] = useState(true);

  const { isInstalled, isConnected, network, address, connect, disconnect } =
    useFreighterConnection({
      paymentRequirement,
      onStatus: setStatus,
    });

  const { usdcBalance, formattedBalance, isFetchingBalance, refreshBalance, resetBalance } =
    useFreighterBalance({
      address,
      paymentRequirement,
      onStatus: setStatus,
    });

  const walletSigner = useFreighterSigner({
    address,
    network,
    paymentRequirement,
  });

  const x402 = window.x402;
  const amount =
    typeof x402.amount === "number"
      ? x402.amount
      : Number(paymentRequirement.maxAmountRequired ?? 0) / 10_000_000;

  const networkName = paymentRequirement.network;
  const chainName = getNetworkDisplayName(networkName);

  const handleConnect = useCallback(async () => {
    await connect();
  }, [connect]);

  const handleDisconnect = useCallback(() => {
    setStatus(
      statusInfo(
        "To fully disconnect, go to Freighter and click the 🌐 icon, then click the minus (-) icon next to 'Connected'.",
      ),
    );
  }, [disconnect, resetBalance]);

  const handlePayment = useCallback(async () => {
    if (!x402) {
      return;
    }

    if (!walletSigner || !address) {
      setStatus(statusError("Connect a Stellar Freighter wallet before paying."));
      return;
    }

    setIsPaying(true);

    try {
      if (usdcBalance === null || usdcBalance === 0n) {
        setStatus(statusInfo("Checking USDC balance..."));
        await refreshBalance();
        if (usdcBalance === null || usdcBalance === 0n) {
          throw new Error(`Insufficient balance. Make sure you have USDC on ${chainName}.`);
        }
      }

      setStatus(statusInfo("Waiting for user signature..."));

      const createHeader = async (version: number) =>
        exact.stellar.createPaymentHeader(walletSigner, version, paymentRequirement);

      const paymentHeader = await createHeader(1);

      setStatus(statusInfo("Settling payment..."));
      const response = await fetch(x402.currentUrl, {
        headers: {
          "X-PAYMENT": paymentHeader,
          "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
        },
      });

      if (response.ok) {
        setStatus(statusSuccess("🎉🎉🎉 Payment successful 🎉🎉🎉! Loading content..."));
        await onSuccessfulResponse(response);
        return;
      }

      if (response.status === 402) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData && typeof errorData.x402Version === "number") {
          const retryPayment = await exact.stellar.createPaymentHeader(
            walletSigner,
            errorData.x402Version,
            paymentRequirement,
          );

          const retryResponse = await fetch(x402.currentUrl, {
            headers: {
              "X-PAYMENT": retryPayment,
              "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
            },
          });

          if (retryResponse.ok) {
            setStatus(statusSuccess("🎉🎉🎉 Payment successful 🎉🎉🎉! Loading content..."));
            await onSuccessfulResponse(retryResponse);
            return;
          }

          throw new Error(
            `Payment retry failed: ${retryResponse.status} ${retryResponse.statusText}`,
          );
        }

        throw new Error(`Payment failed: ${response.statusText}`);
      }

      throw new Error(`Payment failed: ${response.status} ${response.statusText}`);
    } catch (error) {
      setStatus(statusError(error instanceof Error ? error.message : "😭 Payment failed 😭"));
    } finally {
      setIsPaying(false);
    }
  }, [
    x402,
    walletSigner,
    address,
    usdcBalance,
    refreshBalance,
    chainName,
    paymentRequirement,
    onSuccessfulResponse,
  ]);

  return (
    <div className="container gap-8">
      <div className="header">
        <h1 className="title">Payment Required</h1>
        <p>
          {paymentRequirement.description && `${paymentRequirement.description}.`} To access this
          content, please pay ${amount} {chainName} USDC.
        </p>
        {networkName === "stellar-testnet" && (
          <p className="instructions">
            Need Stellar Testnet USDC?{" "}
            <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer">
              Request some <u>here</u>.
            </a>
          </p>
        )}
      </div>

      <div className="content w-full">
        <div className="payment-details">
          <div className="payment-row">
            <span className="payment-label">Wallet:</span>
            <span className="payment-value">
              {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "-"}
            </span>
          </div>
          <div className="payment-row">
            <span className="payment-label">Available balance:</span>
            <span className="payment-value">
              {address ? (
                <button className="balance-button" onClick={() => setHideBalance(prev => !prev)}>
                  {!hideBalance && formattedBalance
                    ? `$${formattedBalance} USDC`
                    : isFetchingBalance
                      ? "Loading..."
                      : "••••• USDC"}
                </button>
              ) : (
                "-"
              )}
            </span>
          </div>
          <div className="payment-row">
            <span className="payment-label">Amount:</span>
            <span className="payment-value">${amount} USDC</span>
          </div>
          <div className="payment-row">
            <span className="payment-label">Network:</span>
            <span className="payment-value">{chainName}</span>
          </div>
        </div>

        <div className="cta-container">
          {isConnected && address ? (
            <>
              <button className="button button-secondary" onClick={handleDisconnect}>
                Disconnect
              </button>
              <button className="button button-primary" onClick={handlePayment} disabled={isPaying}>
                {isPaying ? <Spinner /> : "Pay"}
              </button>
            </>
          ) : (
            <>
              {isInstalled && (
                <button
                  className="button button-primary"
                  onClick={handleConnect}
                  disabled={!isInstalled}
                >
                  Connect Freighter
                </button>
              )}
              {isInstalled === false && (
                <a
                  href="https://www.freighter.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-secondary"
                  style={{ textDecoration: "none", display: "inline-block", textAlign: "center" }}
                >
                  Download Freighter
                </a>
              )}
            </>
          )}
        </div>

        {status && <div className={`status status-${status.type}`}>{status.message}</div>}
      </div>
    </div>
  );
}
