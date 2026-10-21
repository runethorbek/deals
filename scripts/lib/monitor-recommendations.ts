import { loadMonitorConfiguration } from "./monitor-config.ts";
import type {
  MonitorConfigurationOptions,
  MonitorEnvelope,
  MonitorSource
} from "./monitor-config.ts";

export const MONITOR_RECOMMENDATIONS_CONTRACT_VERSION = 1;

const MAX_DISPLAY_NAME_LENGTH = 80;

export type PublishedRecommendation =
  | { strategy: "discount_threshold"; minimum_discount_percent: number }
  | { strategy: "best_match"; minimum_overall_score: number };

export interface PublishedMonitorRecommendation {
  id: string;
  source: MonitorSource;
  display_name: string | null;
  enabled: boolean;
  recommendation: PublishedRecommendation | null;
}

export interface MonitorRecommendationsDocument {
  contract_version: typeof MONITOR_RECOMMENDATIONS_CONTRACT_VERSION;
  monitor_count: number;
  monitors: PublishedMonitorRecommendation[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function parseDisplayName(displayName: unknown): string | null {
  if (displayName === undefined) return null;
  if (
    typeof displayName !== "string" ||
    displayName !== displayName.trim() ||
    displayName.length === 0 ||
    displayName.length > MAX_DISPLAY_NAME_LENGTH
  ) {
    throw new Error("displayName must be a trimmed string of 1-80 characters");
  }
  return displayName;
}

function parseRecommendation(
  source: MonitorSource,
  recommendation: unknown
): PublishedRecommendation | null {
  // Absent means unconfigured. No default strategy is inferred.
  if (recommendation === undefined) return null;
  if (!isObject(recommendation)) {
    throw new Error("recommendation must be an object when present");
  }

  if (recommendation.strategy === "discount_threshold") {
    const percent = recommendation.minimumDiscountPercent;
    if (!hasOnlyKeys(recommendation, ["strategy", "minimumDiscountPercent"])) {
      throw new Error("recommendation contains unknown keys");
    }
    if (source !== "zalando") {
      throw new Error("discount_threshold is allowed only for zalando monitors");
    }
    // The typeof check only narrows for the comparisons below.
    if (
      typeof percent !== "number" ||
      !Number.isSafeInteger(percent) ||
      percent < 1 ||
      percent > 99
    ) {
      throw new Error("minimumDiscountPercent must be an integer from 1 to 99");
    }
    return { strategy: "discount_threshold", minimum_discount_percent: percent };
  }

  if (recommendation.strategy === "best_match") {
    const score = recommendation.minimumOverallScore;
    if (!hasOnlyKeys(recommendation, ["strategy", "minimumOverallScore"])) {
      throw new Error("recommendation contains unknown keys");
    }
    if (
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 10 ||
      // Multiplying by 10 is exact enough in 0..10 that a value with at
      // most one decimal yields an integer and any finer value does not.
      !Number.isInteger(score * 10)
    ) {
      throw new Error(
        "minimumOverallScore must be a number from 0 to 10 with at most one decimal"
      );
    }
    return { strategy: "best_match", minimum_overall_score: score };
  }

  throw new Error("recommendation strategy must be discount_threshold or best_match");
}

/**
 * Validates the recommendation keys of one envelope-checked monitor and
 * returns its published entry. This runs only in the generator and CI; the
 * scanner validators ignore `displayName` and `recommendation`.
 */
export function buildMonitorRecommendation(
  monitor: MonitorEnvelope
): PublishedMonitorRecommendation {
  try {
    return {
      id: monitor.id,
      source: monitor.source,
      display_name: parseDisplayName(monitor.displayName),
      enabled: monitor.enabled,
      recommendation: parseRecommendation(monitor.source, monitor.recommendation)
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid recommendation configuration for monitor ${monitor.id}: ${reason}`);
  }
}

export function buildMonitorRecommendationsDocument(
  monitors: MonitorEnvelope[]
): MonitorRecommendationsDocument {
  // Code-unit order keeps the output independent of locale.
  const entries = monitors
    .map(buildMonitorRecommendation)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    contract_version: MONITOR_RECOMMENDATIONS_CONTRACT_VERSION,
    monitor_count: entries.length,
    monitors: entries
  };
}

export function serializeMonitorRecommendationsDocument(
  document: MonitorRecommendationsDocument
): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function generateMonitorRecommendations(
  options: MonitorConfigurationOptions = {}
): Promise<string> {
  const monitors = await loadMonitorConfiguration(options);
  return serializeMonitorRecommendationsDocument(
    buildMonitorRecommendationsDocument(monitors)
  );
}

/**
 * Throws when the committed document differs from the generator output.
 * Line endings are normalized first, so a CRLF working copy on Windows
 * (core.autocrlf) compares equal to the LF content git stores.
 */
export function assertMonitorRecommendationsInSync(
  generated: string,
  committed: string
): void {
  if (committed.replace(/\r\n/g, "\n") !== generated) {
    throw new Error(
      "public/deals/monitor-recommendations.json is out of date; " +
        "run node scripts/generate-monitor-recommendations.ts"
    );
  }
}
