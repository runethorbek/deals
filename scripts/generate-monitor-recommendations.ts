import fs from "node:fs/promises";
import { generateMonitorRecommendations } from "./lib/monitor-recommendations.ts";

// Regenerates the published monitor recommendation document from
// config/monitors.json. Invalid configuration throws before anything is
// written, so the committed document is never replaced by a partial one.
const OUTPUT_URL = new URL("../public/deals/monitor-recommendations.json", import.meta.url);

const contents = await generateMonitorRecommendations();
await fs.writeFile(OUTPUT_URL, contents, "utf8");

console.log("Wrote public/deals/monitor-recommendations.json");
