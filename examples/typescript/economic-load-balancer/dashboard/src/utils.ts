/**
 * Utility functions for the Economic Load Balancer Dashboard
 */

import {
  USDC_DECIMALS,
  EXPLORER_URLS,
  EXPLORER_NAMES,
  MS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from "./constants";

// ============================================================================
// Address Formatting
// ============================================================================

/**
 * Formats a wallet address to a shortened version
 * @example formatAddress("0x1234567890abcdef") => "0x1234...cdef"
 */
export function formatAddress(
  address: string,
  prefixLength = 6,
  suffixLength = 4
): string {
  if (!address || address.length <= prefixLength + suffixLength) {
    return address;
  }
  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`;
}

// ============================================================================
// Amount Conversion
// ============================================================================

/**
 * Converts atomic units to USDC amount based on network
 */
export function convertAtomicToUsdc(
  atomicAmount: string | undefined,
  network: string
): number {
  if (!atomicAmount) return 0;

  const isEvmNetwork = network.startsWith("base");
  const decimals = isEvmNetwork ? USDC_DECIMALS.EVM : USDC_DECIMALS.STELLAR;

  return parseFloat(atomicAmount) / decimals;
}

// ============================================================================
// Explorer Links
// ============================================================================

/**
 * Generates an explorer URL for a given address and network
 */
export function getExplorerUrl(address: string, network: string): string {
  const explorerFn = EXPLORER_URLS[network as keyof typeof EXPLORER_URLS];
  return explorerFn ? explorerFn(address) : `#${address}`;
}

/**
 * Gets the explorer name for a given network
 */
export function getExplorerName(network: string): string {
  return EXPLORER_NAMES[network as keyof typeof EXPLORER_NAMES] || "Explorer";
}

/**
 * Creates an HTML link to the blockchain explorer
 */
export function createExplorerLink(address: string, network: string): string {
  const url = getExplorerUrl(address, network);
  const name = getExplorerName(network);
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">View on ${name} ↗</a>`;
}

// ============================================================================
// Time Formatting
// ============================================================================

/**
 * Formats current time as HH:MM:SS
 */
export function formatCurrentTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

/**
 * Formats milliseconds into a human-readable duration string
 * @example formatDuration(2500) => "2.5s"
 * @example formatDuration(125000) => "2m 5s"
 */
export function formatDuration(ms: number): string {
  if (ms < MS_PER_SECOND) return `${ms.toFixed(0)}ms`;

  const seconds = ms / MS_PER_SECOND;
  if (seconds < SECONDS_PER_MINUTE) return `${seconds.toFixed(1)}s`;

  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const remainingSeconds = Math.round(seconds % SECONDS_PER_MINUTE);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Calculates and formats relative time since a timestamp
 * @example formatRelativeTime(Date.now() - 5000) => "(5s ago)"
 */
export function formatRelativeTime(timestamp: number): string {
  if (timestamp === 0) return "";
  const secondsAgo = Math.floor((Date.now() - timestamp) / MS_PER_SECOND);
  return `(${secondsAgo}s ago)`;
}

/**
 * Calculates cache age in seconds
 */
export function getCacheAgeSeconds(timestamp: number): number {
  return Math.round((Date.now() - timestamp) / MS_PER_SECOND);
}

// ============================================================================
// Ranking Utilities
// ============================================================================

/**
 * Formats rank number as ordinal (1st, 2nd, 3rd, etc.)
 */
export function formatRank(rank: number | null): string | null {
  if (rank === null) return null;
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `${rank}th`;
}

// ============================================================================
// Payment Logging
// ============================================================================

/**
 * Creates a payment success log message with explorer link
 */
export function createPaymentSuccessMessage(
  amount: number,
  network: string,
  address: string
): string {
  const explorerLink = createExplorerLink(address, network);
  return `✅ Payment of $${amount.toFixed(
    6
  )} USDC succeeded for ${network}. Resource unlocked. ${explorerLink}`;
}

/**
 * Creates a payment failure log message with explorer link
 */
export function createPaymentFailureMessage(
  amount: number,
  network: string,
  address: string,
  error: string
): string {
  const explorerLink = createExplorerLink(address, network);
  return `❌ Payment of $${amount.toFixed(
    6
  )} USDC failed for ${network}: ${error}. ${explorerLink}`;
}

/**
 * Creates a wallet connection log message
 */
export function createWalletConnectionMessage(
  address: string,
  network: string
): string {
  const formattedAddress = formatAddress(address);
  return `Wallet ${formattedAddress} connected for ${network}`;
}
