import fs from "node:fs/promises";

const DEFAULT_CONFIG_URL = new URL("../../config/monitors.json", import.meta.url);
const KNOWN_SOURCES = new Set(["vinted", "scarosso", "zalando"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasValidMonitor(monitor) {
  return (
    isObject(monitor) &&
    typeof monitor.id === "string" &&
    monitor.id.trim().length > 0 &&
    monitor.id === monitor.id.trim() &&
    monitor.id.length <= 100 &&
    KNOWN_SOURCES.has(monitor.source) &&
    typeof monitor.enabled === "boolean" &&
    isObject(monitor.filters)
  );
}

export async function loadMonitorConfiguration({
  configPath = DEFAULT_CONFIG_URL,
  readFile = fs.readFile
} = {}) {
  const contents = await readFile(configPath, "utf8");
  let monitors;
  try {
    monitors = JSON.parse(contents);
  } catch {
    throw new Error("Monitor configuration contains malformed JSON");
  }
  if (!Array.isArray(monitors)) {
    throw new Error("Monitor configuration must be a JSON array");
  }

  const ids = new Set();
  for (const monitor of monitors) {
    if (!hasValidMonitor(monitor) || ids.has(monitor.id)) {
      throw new Error("Invalid monitor configuration envelope");
    }
    ids.add(monitor.id);
  }

  return monitors;
}

export function selectEnabledMonitor(source, monitors) {
  if (!KNOWN_SOURCES.has(source)) {
    throw new Error("Monitor source must be a known non-empty string");
  }

  const sourceLabel = source[0].toUpperCase() + source.slice(1);

  const enabledMonitors = monitors.filter((monitor) => monitor.source === source && monitor.enabled);
  if (enabledMonitors.length > 1) {
    throw new Error(`Monitor configuration must contain at most one enabled ${sourceLabel} monitor`);
  }
  return enabledMonitors[0] ?? null;
}

export async function loadEnabledMonitor(source, options = {}) {
  return selectEnabledMonitor(source, await loadMonitorConfiguration(options));
}
