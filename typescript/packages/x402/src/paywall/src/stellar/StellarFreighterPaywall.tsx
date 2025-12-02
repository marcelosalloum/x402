import { useCallback, useState } from "react";
import type { PaymentRequirements } from "../../../types/verify";
import { getNetworkDisplayName } from "../paywallUtils";
import { Spinner } from "../Spinner";
import { statusError, statusInfo, type Status } from "../status";
import { useFreighterConnection } from "./freighter/useFreighterConnection";
import { useFreighterSigner } from "./freighter/useFreighterSigner";
import { useStellarBalance } from "./useStellarBalance";
import { useStellarPayment } from "./useStellarPayment";

const STELLAR_PAYMENT_SCALE = 10_000_000;

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
  const [hideBalance, setHideBalance] = useState(true);

  const { isInstalled, address, connect, disconnect } = useFreighterConnection({
    paymentRequirement,
    onStatus: setStatus,
  });

  const { tokenBalanceFormatted, isFetchingBalance, refreshBalance, resetBalance } =
    useStellarBalance({
      address,
      paymentRequirement,
      onStatus: setStatus,
    });

  const walletSigner = useFreighterSigner({
    address,
    paymentRequirement,
  });

  const { isPaying, submitPayment } = useStellarPayment({
    x402: window.x402,
    paymentRequirement,
    walletSigner,
    onSuccessfulResponse,
    setStatus,
  });

  const x402 = window.x402;
  const amount =
    typeof x402.amount === "number"
      ? x402.amount
      : Number(paymentRequirement.maxAmountRequired ?? 0) / STELLAR_PAYMENT_SCALE;

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
      setStatus(statusError("Connect a Stellar wallet before paying."));
      return;
    }

    if (tokenBalanceFormatted === "") {
      setStatus(statusInfo("Checking USDC balance..."));
      await refreshBalance();
      if (Number(tokenBalanceFormatted) < amount) {
        setStatus(
          statusError(`Insufficient balance. Make sure you have enough USDC on ${chainName}.`),
        );
      }
    }

    try {
      await submitPayment();
    } catch (error) {
      setStatus(statusError(error instanceof Error ? error.message : "😭 Payment failed 😭"));
    }
  }, [
    x402,
    walletSigner,
    address,
    tokenBalanceFormatted,
    amount,
    chainName,
    refreshBalance,
    submitPayment,
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
                  {!hideBalance && tokenBalanceFormatted
                    ? `$${tokenBalanceFormatted} USDC`
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
          {address ? (
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
