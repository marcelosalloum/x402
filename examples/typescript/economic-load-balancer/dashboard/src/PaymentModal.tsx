import { PaymentModalEvm } from "./PaymentModalEvm.js";
import { PaymentModalStellar } from "./PaymentModalStellar.js";
import type { PaymentRequirements } from "x402/types";

interface PaymentModalProps {
  paymentRequirement: PaymentRequirements;
  serverUrl: string;
  endpointPath: string;
  onSuccess: (data: unknown) => void;
  onClose: () => void;
  onLog?: (message: string, type?: "info" | "success" | "error") => void;
}

/**
 * Payment modal component that routes to EVM or Stellar implementation
 */
export function PaymentModal({
  paymentRequirement,
  serverUrl,
  endpointPath,
  onSuccess,
  onClose,
  onLog,
}: PaymentModalProps) {
  const network = paymentRequirement.network;
  const isEvm = network.startsWith("base");

  if (isEvm) {
    return (
      <PaymentModalEvm
        paymentRequirement={paymentRequirement}
        serverUrl={serverUrl}
        endpointPath={endpointPath}
        onSuccess={onSuccess}
        onClose={onClose}
        onLog={onLog}
      />
    );
  }

  return (
    <PaymentModalStellar
      paymentRequirement={paymentRequirement}
      serverUrl={serverUrl}
      endpointPath={endpointPath}
      onSuccess={onSuccess}
      onClose={onClose}
      onLog={onLog}
    />
  );
}
