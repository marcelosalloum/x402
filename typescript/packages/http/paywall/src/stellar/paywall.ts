import { USDC_PUBNET_ADDRESS, USDC_TESTNET_ADDRESS } from "@x402/stellar";
import type { PaymentRequired } from "../types";
import { getStellarTemplate } from "./template-loader";

/**
 * Gets the Stellar chain config with USDC contract addresses
 *
 * @returns The Stellar chain config
 */
function getChainConfig() {
  return {
    pubnet: {
      usdcAddress: USDC_PUBNET_ADDRESS,
      usdcName: "USDC",
    },
    testnet: {
      usdcAddress: USDC_TESTNET_ADDRESS,
      usdcName: "USDC",
    },
  };
}

interface StellarPaywallOptions {
  amount: number;
  paymentRequired: PaymentRequired;
  currentUrl: string;
  testnet: boolean;
  appName?: string;
  appLogo?: string;
}

/**
 * Generates Stellar-specific paywall HTML
 *
 * @param options - The options for generating the paywall
 * @param options.amount - The amount to be paid in USD
 * @param options.paymentRequired - The payment required response with accepts array
 * @param options.currentUrl - The URL of the content being accessed
 * @param options.testnet - Whether to use testnet or mainnet
 * @param options.appName - The name of the application to display in the wallet connection modal
 * @param options.appLogo - The logo of the application to display in the wallet connection modal
 * @returns HTML string for the paywall page
 */
export function getStellarPaywallHtml(options: StellarPaywallOptions): string {
  const STELLAR_PAYWALL_TEMPLATE = getStellarTemplate();

  if (!STELLAR_PAYWALL_TEMPLATE) {
    return `<!DOCTYPE html><html><body><h1>Stellar Paywall (run pnpm build:paywall to generate full template)</h1></body></html>`;
  }

  const { amount, testnet, paymentRequired, currentUrl, appName, appLogo } = options;

  const logOnTestnet = testnet
    ? "console.log('Stellar Payment required initialized:', window.x402);"
    : "";

  const config = getChainConfig();

  const configScript = `
  <script>
    window.x402 = {
      amount: ${amount},
      paymentRequired: ${JSON.stringify(paymentRequired)},
      testnet: ${testnet},
      currentUrl: ${JSON.stringify(currentUrl)},
      config: {
        chainConfig: ${JSON.stringify(config)},
      },
      appName: ${JSON.stringify(appName || "")},
      appLogo: ${JSON.stringify(appLogo || "")},
    };
    ${logOnTestnet}
  </script>`;

  return STELLAR_PAYWALL_TEMPLATE.replace("</head>", `${configScript}\n</head>`);
}
