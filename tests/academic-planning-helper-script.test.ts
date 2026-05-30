import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = join(repoRoot, "bin", "mju-academic-planning");

describe("academic planning helper script", () => {
  it.runIf(process.platform !== "win32")("has valid bash syntax", async () => {
    const result = await execa("bash", ["-n", helperPath], { reject: false });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});
