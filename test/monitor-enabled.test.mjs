import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("monitor-enabled writes the GitHub enabled output", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dealradar-monitor-"));
  const outputPath = path.join(directory, "github-output");

  try {
    await execFileAsync(process.execPath, ["scripts/monitor-enabled.mjs", "vinted"], {
      cwd: process.cwd(),
      env: { ...process.env, GITHUB_OUTPUT: outputPath }
    });

    assert.equal(await fs.readFile(outputPath, "utf8"), "enabled=true\n");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
