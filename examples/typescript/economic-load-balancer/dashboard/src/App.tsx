import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { PaymentRequirements } from "x402/types";
import { rankPaymentOptions } from "../../cli/network-ranker.js";
import type { PaymentOption } from "../../cli/network-ranker.js";
import { PaymentModal } from "./PaymentModal.js";
import { NetworkCard } from "./NetworkCard.js";
import {
  CRITERIA_CONFIG,
  RANKING_CACHE_TTL_MS,
  RELATIVE_TIME_UPDATE_INTERVAL_MS,
  MIN_ANALYSIS_DELAY_MS,
  DEFAULT_MAX_FEE_USDC,
  MAX_LOG_ENTRIES,
  SERVER_URL,
  ENDPOINT_PATH,
  type RankingCriteria,
} from "./constants.js";
import {
  formatCurrentTime,
  formatRelativeTime,
  getCacheAgeSeconds,
  convertAtomicToUsdc,
} from "./utils.js";
import { rankNetworks, formatCriteriaForDisplay } from "./ranking.js";
import type {
  Network,
  NetworkEstimate,
  RankingResult,
  LogEntry,
  LogEntryType,
  ApiResponse,
  ProtectedResource,
} from "./types.js";

// ============================================================================
// Network Configuration
// ============================================================================

const SUPPORTED_NETWORKS: readonly Network[] = [
  "base-sepolia",
  "stellar-testnet",
] as const;

/**
 * Parses networks from environment variable and validates against whitelist
 */
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

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetches real-time network estimates from the server API
 * @returns Array of network estimates, or empty array on error
 */
async function fetchNetworkEstimates(): Promise<NetworkEstimate[]> {
  try {
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
// Components
// ============================================================================

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
  const [criteria, setCriteria] = useState<RankingCriteria | null>(null);
  const [result, setResult] = useState<RankingResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>("");
  const [lastUpdateTimestamp, setLastUpdateTimestamp] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [paymentRequirement, setPaymentRequirement] =
    useState<PaymentRequirements | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [protectedResource, setProtectedResource] =
    useState<ProtectedResource | null>(null);

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
   * Fetches network estimates and updates state
   */
  const fetchAndUpdateEstimates = useCallback(async () => {
    try {
      const data = await fetchNetworkEstimates();
      if (data.length > 0) {
        setEstimates(data);
        const now = Date.now();
        setLastUpdateTime(formatCurrentTime());
        setLastUpdateTimestamp(now);
      }
      return data;
    } catch (error) {
      console.error("Failed to fetch network estimates:", error);
      addLog("Failed to fetch network estimates", "error");
      return [];
    }
  }, [addLog]);

  /**
   * Fetch network estimates once on mount to display network names
   */
  useEffect(() => {
    fetchAndUpdateEstimates();
  }, [fetchAndUpdateEstimates]);

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

      // No cache, fetch fresh data and perform new analysis
      setIsAnalyzing(true);
      addLog("Fetching latest network estimates...", "info");

      const freshEstimates = await fetchAndUpdateEstimates();

      if (freshEstimates.length === 0) {
        setIsAnalyzing(false);
        addLog("Failed to fetch network estimates", "error");
        return;
      }

      addLog(
        `Analyzing networks for ${formatCriteriaForDisplay(newCriteria)}...`,
        "info"
      );

      // Brief delay for UX feedback
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_ANALYSIS_DELAY_MS)
      );

      try {
        const ranking = rankNetworks(freshEstimates, newCriteria);
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
    [getCachedResult, handleCachedResult, addLog, fetchAndUpdateEstimates]
  );

  /**
   * Auto-refresh criteria when cache expires
   */
  useEffect(() => {
    if (!criteria || !result || isAnalyzing || isLoading) return;

    const checkExpiration = () => {
      const timeSinceResult = Date.now() - result.timestamp;
      if (timeSinceResult >= RANKING_CACHE_TTL_MS) {
        addLog(
          `Cache expired for ${formatCriteriaForDisplay(
            criteria
          )}, auto-refreshing...`,
          "info"
        );
        handleCriteriaChange(criteria);
      }
    };

    checkExpiration();
    const interval = setInterval(
      checkExpiration,
      RELATIVE_TIME_UPDATE_INTERVAL_MS
    );

    return () => clearInterval(interval);
  }, [criteria, result, isAnalyzing, isLoading, addLog, handleCriteriaChange]);

  /**
   * Fetches payment requirements from the server
   */
  const fetchPaymentRequirements = useCallback(async (): Promise<
    PaymentRequirements[]
  > => {
    try {
      const response = await fetch(`${SERVER_URL}${ENDPOINT_PATH}`);
      if (response.ok) {
        const data = await response.json();
        setProtectedResource({ data, timestamp: Date.now() });
        addLog("Resource already accessible (no payment required)", "success");
        return [];
      }
      if (response.status === 402) {
        const errorData = await response.json();
        return errorData.accepts || [];
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      addLog(`Failed to fetch payment requirements: ${errorMessage}`, "error");
      throw error;
    }
  }, [addLog]);

  /**
   * Converts PaymentRequirements to PaymentOption format
   */
  const convertToPaymentOptions = useCallback(
    (requirements: PaymentRequirements[]): PaymentOption[] => {
      return requirements.map((req) => ({
        network: req.network as Network,
        amount: req.maxAmountRequired || "0",
        asset: typeof req.asset === "string" ? req.asset : "USDC",
        payTo: req.payTo,
        description: req.description,
      }));
    },
    []
  );

  /**
   * Handles "Buy Now" button click
   */
  const handleBuy = useCallback(async () => {
    if (!criteria) {
      addLog("Please select a ranking criteria first", "error");
      return;
    }

    addLog(
      `Buy Now clicked with criteria: ${formatCriteriaForDisplay(criteria)}`,
      "info"
    );

    setIsLoading(true);
    setResult(null);

    try {
      addLog("Fetching payment requirements from server...", "info");

      const requirements = await fetchPaymentRequirements();

      if (requirements.length === 0) {
        setIsLoading(false);
        return;
      }

      addLog(`Received ${requirements.length} payment options`, "success");

      const paymentOptions = convertToPaymentOptions(requirements);

      addLog(
        `Ranking networks (criteria: ${formatCriteriaForDisplay(criteria)})...`,
        "info"
      );

      const networkRankerCriteria =
        CRITERIA_CONFIG[criteria].networkRankerCriteria;
      const rankingResult = await rankPaymentOptions(
        paymentOptions,
        networkRankerCriteria
      );

      // Update local ranking result for display
      const localRanking: RankingResult = {
        criteria,
        rankings: rankingResult.rankedOptions.map((ro, idx) => ({
          network: ro.option.network as Network,
          rank: idx + 1,
          estimate: {
            network: ro.option.network as Network,
            feeUsdc: ro.estimate.feeUsdc.toFixed(6),
            feeNative: ro.estimate.feeNative,
            nativeSymbol: ro.estimate.nativeSymbol,
            softFinalityMs: ro.estimate.softFinalityMs,
            hardFinalityMs: ro.estimate.hardFinalityMs,
            isHealthy: ro.estimate.isHealthy,
            latencyMs: ro.estimate.latencyMs,
          },
        })),
        reason: rankingResult.reason,
        timestamp: Date.now(),
      };

      rankingCache.current.set(criteria, localRanking);
      setResult(localRanking);
      addLog(rankingResult.reason, "success");

      const selectedRequirement = requirements.find(
        (req) => req.network === rankingResult.best.network
      );

      if (!selectedRequirement) {
        throw new Error(
          `Payment requirement not found for network: ${rankingResult.best.network}`
        );
      }

      setPaymentRequirement(selectedRequirement);
      setShowPaymentModal(true);
      const amount = convertAtomicToUsdc(
        selectedRequirement.maxAmountRequired,
        selectedRequirement.network
      );
      addLog(
        `Buy Now with ${formatCriteriaForDisplay(criteria)} → Selected ${
          rankingResult.best.network
        } ($${amount.toFixed(6)} USDC)`,
        "info"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      addLog(`Payment setup failed: ${errorMessage}`, "error");
    } finally {
      setIsLoading(false);
    }
  }, [criteria, fetchPaymentRequirements, convertToPaymentOptions, addLog]);

  /**
   * Handles successful payment
   */
  const handlePaymentSuccess = useCallback((data: unknown) => {
    setProtectedResource({ data, timestamp: Date.now() });
    setShowPaymentModal(false);
    setPaymentRequirement(null);
  }, []);

  /**
   * Closes payment modal
   */
  const handleClosePaymentModal = useCallback(() => {
    setShowPaymentModal(false);
    setPaymentRequirement(null);
  }, []);

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

  const maxSoftFinality = useMemo(() => {
    if (estimates.length === 0) return 0;
    return Math.max(...estimates.map((e) => e.softFinalityMs));
  }, [estimates]);

  const maxHardFinality = useMemo(() => {
    if (estimates.length === 0) return 0;
    return Math.max(...estimates.map((e) => e.hardFinalityMs));
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
    if (!criteria || !result || result.timestamp === 0) {
      return "";
    }
    const criteriaLabel = CRITERIA_CONFIG[result.criteria].label;
    const relativeTime = formatRelativeTime(result.timestamp);
    return ` • ${criteriaLabel} Cache: ${relativeTime}`;
  }, [criteria, result, currentTime]);

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
        {lastUpdateTime && (
          <div className="live-indicator">
            <span className="live-dot" />
            <span>
              Live Gas Feed • Updated {lastUpdateTime}
              {cacheDisplayText}
            </span>
          </div>
        )}
      </div>

      <div className="networks-grid">
        {estimates.map((estimate) => (
          <NetworkCard
            key={estimate.network}
            estimate={estimate}
            rank={getRank(estimate.network)}
            hasResult={!!result}
            maxFee={maxFee}
            maxSoftFinality={maxSoftFinality}
            maxHardFinality={maxHardFinality}
            isAnalyzing={isAnalyzing}
            hasCriteriaSelected={criteria !== null}
            criteria={criteria}
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
          disabled={
            isLoading || isAnalyzing || estimates.length === 0 || !criteria
          }
        >
          {isLoading || isAnalyzing ? "Analyzing..." : "Buy Now"}
        </button>
      </div>

      {protectedResource && (
        <div className="protected-resource">
          <div className="protected-resource-header">
            <h2>✅ Protected Resource Unlocked</h2>
            <p>Payment successful! Here's your content:</p>
          </div>
          <div className="protected-resource-content">
            <pre>{JSON.stringify(protectedResource.data, null, 2)}</pre>
          </div>
        </div>
      )}

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
                <span
                  className={`log-message ${log.type}`}
                  dangerouslySetInnerHTML={{ __html: log.message }}
                />
              </div>
            ))
          )}
        </div>
      </div>

      {showPaymentModal && paymentRequirement && (
        <PaymentModal
          paymentRequirement={paymentRequirement}
          serverUrl={SERVER_URL}
          endpointPath={ENDPOINT_PATH}
          onSuccess={handlePaymentSuccess}
          onClose={handleClosePaymentModal}
          onLog={addLog}
        />
      )}
    </div>
  );
}
