import fs from "node:fs/promises";
import { loadValidatedEnabledMonitors } from "./lib/validated-monitor-loader.ts";

// Typed as unchecked input: the loader rejects anything that is not a known
// MonitorSource before `source` is used in the messages below.
const source: string | undefined = process.argv[2];
const enabled = (await loadValidatedEnabledMonitors(source)).length > 0;

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `enabled=${enabled}\n`);
}

console.log(
  enabled
    ? `Enabled ${source} monitor found`
    : `No enabled ${source} monitor; skipping scan`
);
