import fs from "node:fs/promises";
import { loadValidatedEnabledMonitors } from "./lib/validated-monitor-loader.mjs";

const source = process.argv[2];
const enabled = (await loadValidatedEnabledMonitors(source)).length > 0;

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `enabled=${enabled}\n`);
}

console.log(
  enabled
    ? `Enabled ${source} monitor found`
    : `No enabled ${source} monitor; skipping scan`
);
