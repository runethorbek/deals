import fs from "node:fs/promises";

const DEFAULT_CONFIG_URL = new URL("../../config/monitors.json", import.meta.url);

export type MonitorSource = "vinted" | "zalando";

// Typed as a set of unknown values so `has` accepts unchecked input; the
// constructor still only admits MonitorSource values.
const KNOWN_SOURCES: ReadonlySet<unknown> = new Set<MonitorSource>(["vinted", "zalando"]);

/**
 * A monitor that passed the shared envelope check. Source-specific fields
 * (such as `pages`) are not checked here, so they stay `unknown` until a
 * source validator narrows the monitor.
 */
export interface MonitorEnvelope {
  id: string;
  source: MonitorSource;
  enabled: boolean;
  filters: Record<string, unknown>;
  [field: string]: unknown;
}

export interface MonitorConfigurationOptions {
  configPath?: string | URL;
  readFile?: (path: string | URL, encoding: "utf8") => Promise<string>;
}

function isMonitorSource(value: unknown): value is MonitorSource {
  return KNOWN_SOURCES.has(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValidMonitor(monitor: unknown): monitor is MonitorEnvelope {
  return (
    isObject(monitor) &&
    typeof monitor.id === "string" &&
    monitor.id.trim().length > 0 &&
    monitor.id === monitor.id.trim() &&
    monitor.id.length <= 100 &&
    isMonitorSource(monitor.source) &&
    typeof monitor.enabled === "boolean" &&
    isObject(monitor.filters)
  );
}

export async function loadMonitorConfiguration({
  configPath = DEFAULT_CONFIG_URL,
  readFile = fs.readFile
}: MonitorConfigurationOptions = {}): Promise<MonitorEnvelope[]> {
  const contents = await readFile(configPath, "utf8");
  let monitors: unknown;
  try {
    monitors = JSON.parse(contents);
  } catch {
    throw new Error("Monitor configuration contains malformed JSON");
  }
  if (!Array.isArray(monitors)) {
    throw new Error("Monitor configuration must be a JSON array");
  }

  // Array.isArray narrows to any[]; read the entries back as unknown.
  const entries: unknown[] = monitors;
  const ids = new Set<string>();
  const validMonitors: MonitorEnvelope[] = [];
  for (const monitor of entries) {
    if (!hasValidMonitor(monitor) || ids.has(monitor.id)) {
      throw new Error("Invalid monitor configuration envelope");
    }
    ids.add(monitor.id);
    validMonitors.push(monitor);
  }

  return validMonitors;
}

export function selectEnabledMonitor<T extends MonitorEnvelope>(
  source: unknown,
  monitors: T[]
): T | null {
  if (!isMonitorSource(source)) {
    throw new Error("Monitor source must be a known non-empty string");
  }

  // `source` is a known non-empty source, so charAt(0) equals source[0]
  // without the `string | undefined` index type.
  const sourceLabel = source.charAt(0).toUpperCase() + source.slice(1);

  const enabledMonitors = monitors.filter((monitor) => monitor.source === source && monitor.enabled);
  if (enabledMonitors.length > 1) {
    throw new Error(`Monitor configuration must contain at most one enabled ${sourceLabel} monitor`);
  }
  return enabledMonitors[0] ?? null;
}

export function selectEnabledMonitors<T extends MonitorEnvelope>(
  source: unknown,
  monitors: T[]
): T[] {
  if (!isMonitorSource(source)) {
    throw new Error("Monitor source must be a known non-empty string");
  }

  const enabledMonitors = monitors.filter(
    (monitor) => monitor.source === source && monitor.enabled
  );

  return enabledMonitors;
}

export async function loadEnabledMonitor(
  source: unknown,
  options: MonitorConfigurationOptions = {}
): Promise<MonitorEnvelope | null> {
  return selectEnabledMonitor(source, await loadMonitorConfiguration(options));
}
