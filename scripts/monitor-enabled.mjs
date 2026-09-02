import fs from "node:fs/promises";
import { loadValidatedEnabledMonitor } from "./lib/validated-monitor-loader.mjs";

const source = process.argv[2];
const enabled = (await loadValidatedEnabledMonitor(source)) !== null;

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `enabled=${enabled}\n`);
}

console.log(
  enabled
    ? `Enabled ${source} monitor found`
    : `No enabled ${source} monitor; skipping scan`
);
