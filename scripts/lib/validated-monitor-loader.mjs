import {
  loadMonitorConfiguration,
  selectEnabledMonitor,
  selectEnabledMonitors
} from "./monitor-config.mjs";
import { validateVintedMonitor } from "./vinted-monitor.mjs";
import { validateScarossoMonitor } from "./scarosso-monitor.mjs";
import { validateZalandoMonitor } from "./zalando-monitor.mjs";

const validators = {
  vinted: validateVintedMonitor,
  scarosso: validateScarossoMonitor,
  zalando: validateZalandoMonitor
};

function validateMonitor(monitor) {
  try {
    validators[monitor.source](monitor);
  } catch {
    throw new Error(`Invalid ${monitor.source} monitor configuration`);
  }
}

export async function loadValidatedEnabledMonitor(source, options = {}) {
  const monitors = await loadMonitorConfiguration(options);

  for (const monitor of monitors) {
    validateMonitor(monitor);
  }

  return selectEnabledMonitor(source, monitors);
}

export async function loadValidatedEnabledMonitors(source, options = {}) {
  const monitors = await loadMonitorConfiguration(options);

  for (const monitor of monitors) {
    validateMonitor(monitor);
  }

  return selectEnabledMonitors(source, monitors);
}
