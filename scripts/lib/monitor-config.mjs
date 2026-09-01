import fs from "node:fs/promises";

const DEFAULT_CONFIG_URL = new URL(
  "../../config/monitors.json",
  import.meta.url
);

function hasValidEnvelope(monitor, source) {
  return (
    monitor !== null &&
    typeof monitor === "object" &&
    typeof monitor.id === "string" &&
    monitor.id.trim().length > 0 &&
    monitor.id.length <= 100 &&
    monitor.source === source &&
    monitor.enabled === true &&
    monitor.filters !== null &&
    typeof monitor.filters === "object" &&
    !Array.isArray(monitor.filters)
  );
}

export async function loadEnabledMonitor(
  source,
  {
    configPath = DEFAULT_CONFIG_URL,
    readFile = fs.readFile
  } = {}
) {
  if (typeof source !== "string" || source.length === 0) {
    throw new Error("Monitor source must be a non-empty string");
  }

  const contents = await readFile(configPath, "utf8");
  const monitors = JSON.parse(contents);
  const sourceLabel = source[0].toUpperCase() + source.slice(1);

  if (!Array.isArray(monitors)) {
    throw new Error("Monitor configuration must be a JSON array");
  }

  const enabledMonitors = monitors.filter((monitor) => (
    monitor?.source === source && monitor.enabled === true
  ));

  if (enabledMonitors.length !== 1) {
    throw new Error(
      `Monitor configuration must contain exactly one enabled ${sourceLabel} monitor`
    );
  }

  const monitor = enabledMonitors[0];

  if (!hasValidEnvelope(monitor, source)) {
    throw new Error(`Invalid enabled ${sourceLabel} monitor configuration`);
  }

  return monitor;
}
