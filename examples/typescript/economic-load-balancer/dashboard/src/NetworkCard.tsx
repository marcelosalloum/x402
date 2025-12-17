import { formatRank, formatDuration } from "./utils";
import { MS_PER_SECOND, type RankingCriteria } from "./constants";

// ============================================================================
// Types
// ============================================================================

interface NetworkEstimate {
  network: string;
  feeUsdc: string;
  feeNative: string;
  nativeSymbol: string;
  softFinalityMs: number;
  hardFinalityMs: number;
  isHealthy: boolean;
  latencyMs: number;
}

interface NetworkCardProps {
  estimate: NetworkEstimate;
  rank: number | null;
  hasResult: boolean;
  maxFee: number;
  maxSoftFinality?: number;
  maxHardFinality?: number;
  isAnalyzing: boolean;
  hasCriteriaSelected: boolean;
  criteria: RankingCriteria | null;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Network Card Component
 *
 * Displays network information including fees, finality times, and ranking.
 * Shows different states based on analysis progress and criteria selection.
 */
export function NetworkCard({
  estimate,
  rank,
  hasResult,
  maxFee,
  maxSoftFinality = 0,
  maxHardFinality = 0,
  isAnalyzing,
  hasCriteriaSelected,
  criteria,
}: NetworkCardProps) {
  const isFirst = rank === 1;
  const rankLabel = formatRank(rank);

  // Calculate percentage based on selected criteria
  const getProgressData = () => {
    if (!criteria) {
      return {
        label: "Relative Cost",
        percent: (parseFloat(estimate.feeUsdc) / maxFee) * 100,
        value: `${((parseFloat(estimate.feeUsdc) / maxFee) * 100).toFixed(0)}%`,
      };
    }

    switch (criteria) {
      case "lowest-cost":
        return {
          label: "Relative Cost",
          percent: (parseFloat(estimate.feeUsdc) / maxFee) * 100,
          value: `${((parseFloat(estimate.feeUsdc) / maxFee) * 100).toFixed(
            0
          )}%`,
        };
      case "soft-finality":
        return {
          label: "Relative Speed (Soft)",
          percent:
            maxSoftFinality > 0
              ? (estimate.softFinalityMs / maxSoftFinality) * 100
              : 0,
          value: `${(estimate.softFinalityMs / MS_PER_SECOND).toFixed(1)}s`,
        };
      case "hard-finality":
        return {
          label: "Relative Speed (Hard)",
          percent:
            maxHardFinality > 0
              ? (estimate.hardFinalityMs / maxHardFinality) * 100
              : 0,
          value: formatDuration(estimate.hardFinalityMs),
        };
    }
  };

  const progressData = getProgressData();

  // Determine card CSS class based on state
  const cardClass = isAnalyzing
    ? "analyzing"
    : hasResult
    ? isFirst
      ? "first"
      : "other"
    : "";

  // Show only title if no criteria selected
  const showDetailsOnly = hasCriteriaSelected || isAnalyzing;

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

      {showDetailsOnly && (
        <>
          <div className="network-stats">
            <div className="stat-row">
              <span className="stat-label">Fee</span>
              <span
                className={`stat-value ${
                  hasResult && isFirst ? "highlight" : ""
                }`}
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
              <span>{progressData.label}</span>
              <span>{progressData.value}</span>
            </div>
            <div className="progress-bar">
              <div
                className={`progress-fill ${
                  hasResult ? (isFirst ? "first" : "") : "default"
                }`}
                style={{ width: `${progressData.percent}%` }}
              />
            </div>
          </div>
        </>
      )}

      {!showDetailsOnly && (
        <div className="network-placeholder">
          <p>Select a criteria below to see network details</p>
        </div>
      )}
    </div>
  );
}
