import { useCallback, useState } from "react";
import type { PaymentRequirements } from "../../../types/verify";
import { Spinner } from "../Spinner";
import { getNetworkDisplayName } from "../paywallUtils";
import { statusError, statusInfo, type Status } from "../status";
import { useStellarBalance } from "./useStellarBalance";
import { useStellarPayment } from "./useStellarPayment";
import { useSWKConnection } from "./swk/useSWKConnection";
import { useSWKSigner } from "./swk/useSWKSigner";

type StellarWKPaywallProps = {
  paymentRequirement: PaymentRequirements;
  onSuccessfulResponse: (response: Response) => Promise<void>;
};

const STELLAR_PAYMENT_SCALE = 10_000_000;

/**
 * Paywall experience for Stellar networks using Stellar Wallet Kit.
 *
 * @param props - Component props.
 * @param props.paymentRequirement - Payment requirement enforced for Stellar requests.
 * @param props.onSuccessfulResponse - Callback invoked on successful 402 response.
 * @returns JSX element.
 */
export function StellarWKPaywall({
  paymentRequirement,
  onSuccessfulResponse,
}: StellarWKPaywallProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [hideBalance, setHideBalance] = useState(true);

  const { kit, swkWallet, address, connect, disconnect } = useSWKConnection({
    paymentRequirement,
    onStatus: setStatus,
  });

  const { isFetchingBalance, tokenBalanceFormatted, refreshBalance, resetBalance } =
    useStellarBalance({
      address,
      paymentRequirement,
      onStatus: setStatus,
    });

  const walletSigner = useSWKSigner({
    kit,
    swkWallet,
    paymentRequirement,
    address,
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

  const chainName = getNetworkDisplayName(paymentRequirement.network);

  const handleConnect = useCallback(async () => {
    await connect();
  }, [connect]);

  const handleDisconnect = useCallback(async () => {
    await disconnect();
    resetBalance();
    setStatus(
      statusInfo(
        "Wallet disconnected. To fully disconnect some wallets, you may need to disconnect from the wallet app itself.",
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
          content, please pay {amount} {chainName} USDC.
        </p>
        {paymentRequirement.network === "stellar-testnet" && (
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
          {!address ? (
            <>
              {kit && (
                <button className="button button-primary" onClick={handleConnect}>
                  Connect Wallet
                </button>
              )}
              {!kit && <div className="status status-info">Loading wallet options...</div>}
            </>
          ) : (
            <>
              <button className="button button-secondary" onClick={handleDisconnect}>
                Disconnect
              </button>
              <button className="button button-primary" onClick={handlePayment} disabled={isPaying}>
                {!isPaying ? "Pay" : <Spinner />}
              </button>
            </>
          )}
        </div>

        {status && <div className={`status status-${status.type}`}>{status.message}</div>}
      </div>
    </div>
  );
}
