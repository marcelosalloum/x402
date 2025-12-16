import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ============================================================================
// Types
// ============================================================================

type Network = "base-sepolia" | "stellar-testnet";
type RankingCriteria = "lowest-cost" | "soft-finality" | "hard-finality";
type LogEntryType = "info" | "success" | "error" | "cached";

interface NetworkEstimate {
  network: Network;
  feeUsdc: string;
  feeNative: string;
  nativeSymbol: string;
  softFinalityMs: number;
  hardFinalityMs: number;
  isHealthy: boolean;
  latencyMs: number;
}

interface NetworkRanking {
  network: Network;
  rank: number;
  estimate: NetworkEstimate;
}

interface RankingResult {
  criteria: RankingCriteria;
  rankings: NetworkRanking[];
  reason: string;
  timestamp: number;
}

interface LogEntry {
  time: string;
  message: string;
  type: LogEntryType;
}

interface ApiResponse {
  estimates: Array<{
    network: Network;
    feeUsdc: number;
    feeNative: string;
    nativeSymbol: string;
    softFinalityMs: number;
    hardFinalityMs: number;
    isHealthy: boolean;
    latencyMs: number;
  }>;
  timestamp?: number;
}

// ============================================================================
// Constants
// ============================================================================

const RANKING_CACHE_TTL_MS = 60_000; // 60 seconds
const NETWORK_ESTIMATES_POLL_INTERVAL_MS = 5_000; // 5 seconds
const RELATIVE_TIME_UPDATE_INTERVAL_MS = 1_000; // 1 second
const MIN_ANALYSIS_DELAY_MS = 300; // UX feedback delay
const BUY_ANALYSIS_DELAY_MS = 600; // Simulated analysis delay
const DEFAULT_MAX_FEE_USDC = 0.001;
const MAX_LOG_ENTRIES = 20;
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;

// Supported networks whitelist
const SUPPORTED_NETWORKS: readonly Network[] = [
  "base-sepolia",
  "stellar-testnet",
] as const;

// Parse networks from env var, validate against whitelist
function getNetworksFromEnv(): Network[] {
  const envNetworks = import.meta.env.VITE_NETWORKS;
  if (!envNetworks) {
    return ["base-sepolia", "stellar-testnet"];
  }

  const networks = envNetworks.split(",").map((n: string) => n.trim());
  const validNetworks = networks.filter((n: string) =>
    SUPPORTED_NETWORKS.includes(n as Network)
  );

  if (validNetworks.length === 0) {
    console.warn(
      "No valid networks found in VITE_NETWORKS, defaulting to base-sepolia,stellar-testnet"
    );
    return ["base-sepolia", "stellar-testnet"];
  }

  if (validNetworks.length !== networks.length) {
    const invalid = networks.filter(
      (n: string) => !SUPPORTED_NETWORKS.includes(n as Network)
    );
    console.warn(
      `Invalid networks in VITE_NETWORKS (${invalid.join(
        ", "
      )}), using only valid ones`
    );
  }

  return validNetworks as Network[];
}

const CONFIGURED_NETWORKS = getNetworksFromEnv();

const CRITERIA_CONFIG: Record<
  RankingCriteria,
  { label: string; displayName: string; emoji: string }
> = {
  "lowest-cost": { label: "Cost", displayName: "lowest cost", emoji: "💰" },
  "soft-finality": {
    label: "Soft Finality",
    displayName: "soft finality",
    emoji: "⚡",
  },
  "hard-finality": {
    label: "Hard Finality",
    displayName: "hard finality",
    emoji: "🔒",
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Formats current time as HH:MM:SS
 */
function formatCurrentTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

/**
 * Formats milliseconds into a human-readable duration string
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "2.5s", "1m 30s", "500ms")
 */
function formatDuration(ms: number): string {
  if (ms < MS_PER_SECOND) return `${ms.toFixed(0)}ms`;
  const seconds = ms / MS_PER_SECOND;
  if (seconds < SECONDS_PER_MINUTE) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${Math.round(
    seconds % SECONDS_PER_MINUTE
  )}s`;
}

/**
 * Calculates and formats relative time since a timestamp
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted string like "(5s ago)" or empty string if timestamp is 0
 */
function formatRelativeTime(timestamp: number): string {
  if (timestamp === 0) return "";
  const secondsAgo = Math.floor((Date.now() - timestamp) / MS_PER_SECOND);
  return `(${secondsAgo}s ago)`;
}

/**
 * Converts criteria to human-readable label
 */
function getCriteriaLabel(criteria: RankingCriteria): string {
  return CRITERIA_CONFIG[criteria].label;
}

/**
 * Converts criteria to display-friendly string (for logs)
 */
function formatCriteriaForDisplay(criteria: RankingCriteria): string {
  return CRITERIA_CONFIG[criteria].displayName;
}

/**
 * Formats rank number as ordinal (1st, 2nd, 3rd, etc.)
 * @param rank - Rank number (1-based)
 * @returns Ordinal string or null if rank is null
 */
function formatRank(rank: number | null): string | null {
  if (rank === null) return null;
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `${rank}th`;
}

/**
 * Calculates cache age in seconds
 */
function getCacheAgeSeconds(timestamp: number): number {
  return Math.round((Date.now() - timestamp) / MS_PER_SECOND);
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetches real-time network estimates from the server API
 * @returns Array of network estimates, or empty array on error
 */
async function fetchNetworkEstimates(): Promise<NetworkEstimate[]> {
  try {
    // Build query string with networks from env var
    const params = new URLSearchParams();
    CONFIGURED_NETWORKS.forEach((network) => {
      params.append("networks", network);
    });
    const url = `/api/network-estimates?${params.toString()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as ApiResponse;

    return data.estimates.map((est) => ({
      ...est,
      feeUsdc: est.feeUsdc.toFixed(6),
    }));
  } catch (error) {
    console.error("Failed to fetch network estimates:", error);
    return [];
  }
}

// ============================================================================
// Ranking Logic
// ============================================================================

/**
 * Compares two network estimates based on the specified criteria
 * @param a - First network estimate
 * @param b - Second network estimate
 * @param criteria - Ranking criteria
 * @returns Negative if a < b, positive if a > b, 0 if equal
 */
function compareNetworks(
  a: NetworkEstimate,
  b: NetworkEstimate,
  criteria: RankingCriteria
): number {
  switch (criteria) {
    case "lowest-cost":
      return parseFloat(a.feeUsdc) - parseFloat(b.feeUsdc);
    case "soft-finality":
      return a.softFinalityMs - b.softFinalityMs;
    case "hard-finality":
      return a.hardFinalityMs - b.hardFinalityMs;
  }
}

/**
 * Generates a human-readable reason for why a network was ranked first
 * @param first - Top-ranked network
 * @param second - Second-ranked network
 * @param criteria - Ranking criteria used
 * @returns Explanation string
 */
function generateRankingReason(
  first: NetworkRanking,
  second: NetworkRanking,
  criteria: RankingCriteria
): string {
  switch (criteria) {
    case "lowest-cost": {
      const ratio = (
        parseFloat(second.estimate.feeUsdc) / parseFloat(first.estimate.feeUsdc)
      ).toFixed(1);
      return `${first.network} is ${ratio}x cheaper than ${second.network} ($${first.estimate.feeUsdc} vs $${second.estimate.feeUsdc})`;
    }
    case "soft-finality": {
      const ratio = (
        second.estimate.softFinalityMs / first.estimate.softFinalityMs
      ).toFixed(1);
      const firstSeconds = (
        first.estimate.softFinalityMs / MS_PER_SECOND
      ).toFixed(1);
      const secondSeconds = (
        second.estimate.softFinalityMs / MS_PER_SECOND
      ).toFixed(1);
      return `${first.network} is ${ratio}x faster (soft) than ${second.network} (${firstSeconds}s vs ${secondSeconds}s)`;
    }
    case "hard-finality": {
      const ratio = (
        second.estimate.hardFinalityMs / first.estimate.hardFinalityMs
      ).toFixed(1);
      return `${first.network} is ${ratio}x faster (hard) than ${
        second.network
      } (${formatDuration(first.estimate.hardFinalityMs)} vs ${formatDuration(
        second.estimate.hardFinalityMs
      )})`;
    }
  }
}

/**
 * Ranks networks based on the specified criteria
 * @param estimates - Network estimates to rank
 * @param criteria - Ranking criteria
 * @returns Ranking result with sorted networks and explanation
 * @throws Error if fewer than 2 networks are provided
 */
function rankNetworks(
  estimates: NetworkEstimate[],
  criteria: RankingCriteria
): RankingResult {
  if (estimates.length < 2) {
    throw new Error("Ranking requires at least 2 networks");
  }

  const sorted = [...estimates].sort((a, b) => compareNetworks(a, b, criteria));

  const rankings: NetworkRanking[] = sorted.map((estimate, index) => ({
    network: estimate.network,
    rank: index + 1,
    estimate,
  }));

  const [first, second] = rankings;
  if (!first || !second) {
    throw new Error("Insufficient rankings generated");
  }

  const reason = generateRankingReason(first, second, criteria);

  return {
    criteria,
    rankings,
    reason,
    timestamp: Date.now(),
  };
}

// ============================================================================
// Components
// ============================================================================

interface NetworkCardProps {
  estimate: NetworkEstimate;
  rank: number | null;
  hasResult: boolean;
  maxFee: number;
  isAnalyzing: boolean;
}

/**
 * Displays a single network's estimate with ranking information
 */
function NetworkCard({
  estimate,
  rank,
  hasResult,
  maxFee,
  isAnalyzing,
}: NetworkCardProps) {
  const feePercent = (parseFloat(estimate.feeUsdc) / maxFee) * 100;
  const isFirst = rank === 1;
  const rankLabel = formatRank(rank);

  // Determine card CSS class based on state
  const cardClass = isAnalyzing
    ? "analyzing"
    : hasResult
    ? isFirst
      ? "first"
      : "other"
    : "";

  return (
    <div className={`network-card ${cardClass}`}>
      <div className="network-header">
        <span className="network-name">
          {hasResult && isFirst && <span className="trophy">🏆 </span>}
          {estimate.network}
        </span>
        {hasResult && rankLabel && (
          <span className={`network-badge ${isFirst ? "first" : "other"}`}>
            {rankLabel}
          </span>
        )}
      </div>

      <div className="network-stats">
        <div className="stat-row">
          <span className="stat-label">Fee</span>
          <span
            className={`stat-value ${hasResult && isFirst ? "highlight" : ""}`}
          >
            ${estimate.feeUsdc} USDC
          </span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Native</span>
          <span className="stat-value">
            {estimate.feeNative} {estimate.nativeSymbol}
          </span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Soft Finality</span>
          <span className="stat-value">
            {(estimate.softFinalityMs / MS_PER_SECOND).toFixed(1)}s
          </span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Hard Finality</span>
          <span className="stat-value">
            {formatDuration(estimate.hardFinalityMs)}
          </span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Health</span>
          <span className="stat-value">
            {estimate.isHealthy ? "🟢 Healthy" : "🔴 Unhealthy"}
          </span>
        </div>
      </div>

      <div className="progress-container">
        <div className="progress-label">
          <span>Relative Cost</span>
          <span>{feePercent.toFixed(0)}%</span>
        </div>
        <div className="progress-bar">
          <div
            className={`progress-fill ${
              hasResult ? (isFirst ? "first" : "") : "default"
            }`}
            style={{ width: `${feePercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

interface CriteriaButtonProps {
  criteria: RankingCriteria;
  isActive: boolean;
  onClick: () => void;
  disabled: boolean;
}

/**
 * Renders a criteria selection button
 */
function CriteriaButton({
  criteria,
  isActive,
  onClick,
  disabled,
}: CriteriaButtonProps) {
  const config = CRITERIA_CONFIG[criteria];
  return (
    <button
      className={`criteria-btn ${isActive ? "active" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {config.emoji} {config.label}
    </button>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function App() {
  // State
  const [estimates, setEstimates] = useState<NetworkEstimate[]>([]);
  const [criteria, setCriteria] = useState<RankingCriteria>("lowest-cost");
  const [result, setResult] = useState<RankingResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>("");
  const [lastUpdateTimestamp, setLastUpdateTimestamp] = useState<number>(0);
  const [, setCurrentTime] = useState<number>(Date.now()); // Used to trigger re-renders

  // Cache for ranking results per criteria
  const rankingCache = useRef<Map<RankingCriteria, RankingResult>>(new Map());

  // ============================================================================
  // Logging
  // ============================================================================

  /**
   * Adds a log entry to the decision log
   */
  const addLog = useCallback((message: string, type: LogEntryType = "info") => {
    setLogs((prev) => [
      { time: formatCurrentTime(), message, type },
      ...prev.slice(0, MAX_LOG_ENTRIES - 1),
    ]);
  }, []);

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Retrieves a cached ranking result if it's still valid
   * @param forCriteria - Criteria to check cache for
   * @returns Cached result or null if not found/expired
   */
  const getCachedResult = useCallback(
    (forCriteria: RankingCriteria): RankingResult | null => {
      const cached = rankingCache.current.get(forCriteria);
      if (cached && Date.now() - cached.timestamp < RANKING_CACHE_TTL_MS) {
        return cached;
      }
      return null;
    },
    []
  );

  /**
   * Handles cached result display and logging
   */
  const handleCachedResult = useCallback(
    (cached: RankingResult, criteriaName: string) => {
      const cacheAgeSeconds = getCacheAgeSeconds(cached.timestamp);
      addLog(
        `Using cached ${criteriaName} result (${cacheAgeSeconds}s old)`,
        "cached"
      );
      setResult(cached);
      addLog(cached.reason, "success");
    },
    [addLog]
  );

  // ============================================================================
  // Data Fetching
  // ============================================================================

  /**
   * Fetches network estimates periodically and updates state
   */
  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await fetchNetworkEstimates();
        if (data.length > 0) {
          setEstimates(data);
          const now = Date.now();
          setLastUpdateTime(formatCurrentTime());
          setLastUpdateTimestamp(now);
        }
      } catch (error) {
        console.error("Failed to fetch network estimates:", error);
        addLog("Failed to fetch network estimates. Retrying...", "error");
      }
    };

    // Fetch immediately, then poll at interval
    fetchData();
    const interval = setInterval(fetchData, NETWORK_ESTIMATES_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [addLog]);

  /**
   * Updates relative time display every second
   */
  useEffect(() => {
    if (lastUpdateTimestamp === 0) return;

    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, RELATIVE_TIME_UPDATE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [lastUpdateTimestamp]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles criteria change with caching support
   */
  const handleCriteriaChange = useCallback(
    async (newCriteria: RankingCriteria) => {
      setCriteria(newCriteria);

      // Check cache first
      const cached = getCachedResult(newCriteria);
      if (cached) {
        handleCachedResult(cached, formatCriteriaForDisplay(newCriteria));
        return;
      }

      // No cache, perform new analysis
      setIsAnalyzing(true);
      addLog(
        `Analyzing networks for ${formatCriteriaForDisplay(newCriteria)}...`,
        "info"
      );

      // Brief delay for UX feedback
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_ANALYSIS_DELAY_MS)
      );

      try {
        const ranking = rankNetworks(estimates, newCriteria);
        rankingCache.current.set(newCriteria, ranking);
        setResult(ranking);
        setIsAnalyzing(false);
        addLog(ranking.reason, "success");
      } catch (error) {
        setIsAnalyzing(false);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        addLog(`Failed to rank networks: ${errorMessage}`, "error");
      }
    },
    [estimates, getCachedResult, handleCachedResult, addLog]
  );

  /**
   * Handles "Buy Now" button click
   */
  const handleBuy = useCallback(async () => {
    setIsLoading(true);
    setResult(null);

    // Check cache first
    const cached = getCachedResult(criteria);
    if (cached) {
      handleCachedResult(cached, formatCriteriaForDisplay(criteria));
      addLog(
        `⚠️ Demo mode: No actual payment. Would pay on ${cached.rankings[0].network}.`,
        "info"
      );
      setIsLoading(false);
      return;
    }

    addLog(
      `Starting network analysis (criteria: ${formatCriteriaForDisplay(
        criteria
      )})...`,
      "info"
    );

    // Simulate analysis delay
    await new Promise((resolve) => setTimeout(resolve, BUY_ANALYSIS_DELAY_MS));

    try {
      const ranking = rankNetworks(estimates, criteria);
      rankingCache.current.set(criteria, ranking);
      setResult(ranking);

      addLog(ranking.reason, "success");
      addLog(
        `⚠️ Demo mode: No actual payment. Would pay on ${ranking.rankings[0].network}.`,
        "info"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      addLog(`Failed to rank networks: ${errorMessage}`, "error");
    } finally {
      setIsLoading(false);
    }
  }, [criteria, estimates, getCachedResult, handleCachedResult, addLog]);

  // ============================================================================
  // Computed Values
  // ============================================================================

  const maxFee = useMemo(() => {
    if (estimates.length === 0) return DEFAULT_MAX_FEE_USDC;
    return Math.max(
      ...estimates.map((e) => parseFloat(e.feeUsdc)),
      DEFAULT_MAX_FEE_USDC
    );
  }, [estimates]);

  /**
   * Gets the rank for a specific network from the current result
   */
  const getRank = useCallback(
    (network: Network): number | null => {
      if (!result) return null;
      const found = result.rankings.find((r) => r.network === network);
      return found ? found.rank : null;
    },
    [result]
  );

  /**
   * Gets the cache display text for the current ranking result
   */
  const cacheDisplayText = useMemo((): string => {
    if (!result || result.timestamp === 0) {
      if (lastUpdateTimestamp > 0) {
        return formatRelativeTime(lastUpdateTimestamp);
      }
      return "";
    }
    const criteriaLabel = getCriteriaLabel(result.criteria);
    const relativeTime = formatRelativeTime(result.timestamp);
    return ` • ${criteriaLabel} Cache: ${relativeTime}`;
  }, [result, lastUpdateTimestamp]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="app">
      <header className="header">
        <h1>x402 Economic Load Balancer</h1>
        <p>Automatic payment routing for optimal cost and speed</p>
      </header>

      <div className="product-card">
        <div className="product-header">
          <h2 className="product-title">🤖 Premium Agent Insight</h2>
          <span className="product-price">$0.001 USDC</span>
        </div>
        <p className="product-description">
          AI-powered market analysis with real-time signals, sentiment analysis,
          and trading recommendations.
        </p>
        <div className="live-indicator">
          <span className="live-dot" />
          <span>
            Live Gas Feed • Updated {lastUpdateTime}
            {cacheDisplayText}
          </span>
        </div>
      </div>

      <div className="networks-grid">
        {estimates.map((estimate) => (
          <NetworkCard
            key={estimate.network}
            estimate={estimate}
            rank={getRank(estimate.network)}
            hasResult={!!result}
            maxFee={maxFee}
            isAnalyzing={isAnalyzing}
          />
        ))}
      </div>

      <div className="buy-section">
        <div className="criteria-selector">
          {(Object.keys(CRITERIA_CONFIG) as RankingCriteria[]).map((c) => (
            <CriteriaButton
              key={c}
              criteria={c}
              isActive={criteria === c}
              onClick={() => handleCriteriaChange(c)}
              disabled={isLoading || isAnalyzing}
            />
          ))}
        </div>

        <button
          className="buy-button"
          onClick={handleBuy}
          disabled={isLoading || isAnalyzing || estimates.length === 0}
        >
          {isLoading || isAnalyzing ? "Analyzing..." : "Buy Now"}
        </button>
      </div>

      <div className="log-panel">
        <div className="log-header">
          <span>📋</span>
          <span>Decision Log</span>
        </div>
        <div className="log-entries">
          {logs.length === 0 ? (
            <div className="log-entry">
              <span className="log-message">
                Click "Buy Now" or select a criteria to see the load balancer in
                action
              </span>
            </div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="log-entry">
                <span className="log-time">[{log.time}]</span>
                <span className={`log-message ${log.type}`}>{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
