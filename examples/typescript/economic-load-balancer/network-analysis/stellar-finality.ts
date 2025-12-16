import { Networks } from "@stellar/stellar-sdk";

export type StellarNetwork = "stellar-testnet" | "stellar-mainnet";

interface NetworkConfig {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
}

const networkConfigs: Record<StellarNetwork, NetworkConfig> = {
  "stellar-testnet": {
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
  },
  "stellar-mainnet": {
    rpcUrl: "https://mainnet.sorobanrpc.com",
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: Networks.PUBLIC,
  },
};

export interface StellarFinalityEstimate {
  network: StellarNetwork;
  softFinalitySeconds: number;
  hardFinalitySeconds: number;
  softFinalityFormatted: string;
  hardFinalityFormatted: string;
  finalityNotes: string;
  softFinalitySource: string;
  hardFinalitySource: string;
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}

interface HorizonLedger {
  closed_at: string;
  sequence: number;
}

interface HorizonResponse {
  _embedded: {
    records: HorizonLedger[];
  };
}

async function measureLedgerCloseTime(
  config: NetworkConfig
): Promise<{ seconds: number; source: string }> {
  const response = await fetch(
    `${config.horizonUrl}/ledgers?order=desc&limit=10`
  );

  if (!response.ok) {
    throw new Error(
      `Horizon API returned ${response.status}: ${response.statusText}`
    );
  }

  const data: HorizonResponse = await response.json();
  const ledgers = data._embedded.records;

  if (ledgers.length < 2) {
    throw new Error(
      `Insufficient ledger data: received ${ledgers.length} ledgers, need at least 2`
    );
  }

  const closeTimes: number[] = [];
  for (let i = 0; i < ledgers.length - 1; i++) {
    const currentTime = new Date(ledgers[i].closed_at).getTime();
    const nextTime = new Date(ledgers[i + 1].closed_at).getTime();
    const diffSeconds = (currentTime - nextTime) / 1000;

    if (diffSeconds <= 0 || diffSeconds > 60) {
      throw new Error(
        `Invalid ledger close time difference: ${diffSeconds}s (expected 0-60s)`
      );
    }

    closeTimes.push(diffSeconds);
  }

  const averageCloseTime =
    closeTimes.reduce((sum, time) => sum + time, 0) / closeTimes.length;

  if (averageCloseTime <= 0 || averageCloseTime > 60) {
    throw new Error(
      `Invalid average ledger close time: ${averageCloseTime}s (expected 0-60s)`
    );
  }

  return {
    seconds: averageCloseTime,
    source: `Measured from last ${
      ledgers.length
    } ledgers (avg: ${averageCloseTime.toFixed(2)}s, range: ${Math.min(
      ...closeTimes
    ).toFixed(1)}s-${Math.max(...closeTimes).toFixed(1)}s)`,
  };
}

export async function getStellarFinality(
  network: StellarNetwork = "stellar-testnet"
): Promise<StellarFinalityEstimate> {
  const config = networkConfigs[network];
  if (!config) {
    throw new Error(
      `Unsupported network: ${network}. Supported: ${Object.keys(
        networkConfigs
      ).join(", ")}`
    );
  }

  const ledgerTime = await measureLedgerCloseTime(config);

  const finalityNotes =
    "Stellar uses SCP consensus. Soft and hard finality are equivalent (1 ledger close)";

  return {
    network,
    softFinalitySeconds: ledgerTime.seconds,
    hardFinalitySeconds: ledgerTime.seconds,
    softFinalityFormatted: formatSeconds(ledgerTime.seconds),
    hardFinalityFormatted: formatSeconds(ledgerTime.seconds),
    finalityNotes,
    softFinalitySource: ledgerTime.source,
    hardFinalitySource: "Same as soft (SCP provides immediate finality)",
  };
}
