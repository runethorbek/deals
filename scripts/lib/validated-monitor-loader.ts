import {
  loadMonitorConfiguration,
  selectEnabledMonitor,
  selectEnabledMonitors
} from "./monitor-config.ts";
import type {
  MonitorConfigurationOptions,
  MonitorEnvelope,
  MonitorSource
} from "./monitor-config.ts";
import { validateVintedMonitor } from "./vinted-monitor.ts";
import type { VintedMonitor } from "./vinted-monitor.ts";
import { validateZalandoMonitor } from "./zalando-monitor.ts";
import type { ZalandoMonitor } from "./zalando-monitor.ts";

export type Monitor = VintedMonitor | ZalandoMonitor;

const validators: Record<MonitorSource, (monitor: MonitorEnvelope) => void> = {
  vinted: validateVintedMonitor,
  zalando: validateZalandoMonitor
};

function validateMonitor(monitor: MonitorEnvelope): asserts monitor is Monitor {
  try {
    validators[monitor.source](monitor);
  } catch {
    throw new Error(`Invalid ${monitor.source} monitor configuration`);
  }
}

export async function loadValidatedEnabledMonitor(
  source: unknown,
  options: MonitorConfigurationOptions = {}
): Promise<Monitor | null> {
  const monitors = await loadMonitorConfiguration(options);

  const validatedMonitors: Monitor[] = [];
  for (const monitor of monitors) {
    validateMonitor(monitor);
    validatedMonitors.push(monitor);
  }

  return selectEnabledMonitor(source, validatedMonitors);
}

export async function loadValidatedEnabledMonitors(
  source: unknown,
  options: MonitorConfigurationOptions = {}
): Promise<Monitor[]> {
  const monitors = await loadMonitorConfiguration(options);

  const validatedMonitors: Monitor[] = [];
  for (const monitor of monitors) {
    validateMonitor(monitor);
    validatedMonitors.push(monitor);
  }

  return selectEnabledMonitors(source, validatedMonitors);
}
