import axios from "axios";
import type { AxiosInstance } from "axios";
import type { WalletClient } from "viem";
import { withPaymentInterceptor } from "x402-axios";
import type { Signer } from "x402/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

// Base axios instance without payment interceptor
const defaultApiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// This will be dynamically set based on wallet connection
let apiClient: AxiosInstance = defaultApiClient;

// Update the API client with a wallet
export function updateApiClient(
  walletClient: WalletClient | Signer | null,
  walletType: "evm" | "stellar" | null
) {
  if (!walletClient || !walletType) {
    apiClient = defaultApiClient;
    console.log("⚠️ API client reset - no wallet connected");
    return;
  }

  if (walletType === "evm") {
    apiClient = withPaymentInterceptor(defaultApiClient, walletClient as any);
    console.log(
      "💳 API client updated with EVM wallet:",
      (walletClient as WalletClient).account?.address
    );
  } else if (walletType === "stellar") {
    apiClient = withPaymentInterceptor(defaultApiClient, walletClient as Signer);
    console.log("⭐ API client updated with Stellar wallet");
  } else {
    apiClient = defaultApiClient;
    console.log("⚠️ API client reset - unknown wallet type:", walletType);
  }
}

// API endpoints
export const api = {
  // Free endpoints
  getHealth: async () => {
    const response = await apiClient.get("/api/health");
    return response.data;
  },

  getPaymentOptions: async () => {
    const response = await apiClient.get("/api/payment-options");
    return response.data;
  },

  validateSession: async (sessionId: string) => {
    const response = await apiClient.get(`/api/session/${sessionId}`);
    return response.data;
  },

  getActiveSessions: async () => {
    const response = await apiClient.get("/api/sessions");
    return response.data;
  },

  // Paid endpoints
  purchase24HourSession: async () => {
    console.log("🔐 Purchasing 24-hour session access...");
    const response = await apiClient.post("/api/pay/session");
    console.log("✅ 24-hour session created:", response.data);
    return response.data;
  },

  purchaseOneTimeAccess: async () => {
    console.log("⚡ Purchasing one-time access...");
    const response = await apiClient.post("/api/pay/onetime");
    console.log("✅ One-time access granted:", response.data);
    return response.data;
  },
};

// Types for API responses
export interface PaymentOption {
  name: string;
  endpoint: string;
  price: string;
  description: string;
}

export interface Session {
  id: string;
  type: "24hour" | "onetime";
  createdAt: string;
  expiresAt: string;
  validFor?: string;
  remainingTime?: number;
}

export interface SessionValidation {
  valid: boolean;
  error?: string;
  session?: Session;
}
