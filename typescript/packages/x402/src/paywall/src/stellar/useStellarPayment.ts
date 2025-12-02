import { useCallback, useState } from "react";
import { createPaymentHeader as createStellarPaymentHeader } from "../../../schemes/exact/stellar/client";
import type { Ed25519Signer } from "../../../shared/stellar";
import { statusError, statusInfo, statusSuccess, type Status } from "../status";
import type { PaymentRequirements } from "../../../types/verify";

type UseStellarPaymentParams = {
  x402: X402Window | null;
  paymentRequirement: PaymentRequirements | null;
  walletSigner: Ed25519Signer | null;
  setStatus: (status: Status | null) => void;
  onSuccessfulResponse: (response: Response) => Promise<void>;
};

type UseStellarPaymentResult = {
  isPaying: boolean;
  submitPayment: () => Promise<void>;
};

type X402Window = typeof window.x402;

const INITIAL_X402_VERSION = 1;

/**
 * Handles Stellar payment submission.
 *
 * @param params - Hook parameters.
 * @param params.x402 - Bootstrapped x402 object containing `currentUrl`.
 * @param params.walletSigner - The signer responsible for Stellar signatures.
 * @param params.paymentRequirement - Active payment requirement in effect.
 * @param params.onSuccessfulResponse - Callback invoked once paywall returns success.
 * @param params.setStatus - UI status setter used for toast-like messages.
 * @returns Handlers to trigger payments and the current loading state.
 */
export function useStellarPayment(params: UseStellarPaymentParams): UseStellarPaymentResult {
  const { x402, walletSigner, paymentRequirement, onSuccessfulResponse, setStatus } = params;
  const [isPaying, setIsPaying] = useState(false);

  const submitPayment = useCallback(async () => {
    if (!x402 || !walletSigner || !paymentRequirement) {
      setStatus(statusError("Unable to submit Stellar payment; wallet or config missing."));
      return;
    }

    setIsPaying(true);
    try {
      setStatus(statusInfo("Waiting for user signature..."));
      const paymentHeader = await createStellarPaymentHeader(
        walletSigner,
        INITIAL_X402_VERSION,
        paymentRequirement,
      );

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
          const retryPayment = await createStellarPaymentHeader(
            walletSigner,
            errorData.x402Version,
            paymentRequirement,
          );

          setStatus(statusInfo("Retrying payment..."));
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
  }, [walletSigner, x402, paymentRequirement, onSuccessfulResponse, setStatus]);

  return { isPaying, submitPayment };
}
