#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const installSource = readFileSync(join(ROOT, "scripts", "install-skill.mjs"), "utf8");
assert.match(installSource, /^#!\/usr\/bin\/env node\r?\n/);
assert.doesNotMatch(installSource, /^#!\/usr\/bin\/env node\\n/);
assert.match(installSource, /--provider <id>/);
assert.match(installSource, /--model <id>/);
assert.match(installSource, /preservedConfig/);
assert.match(installSource, /COPY_DIRS\s*=\s*\[\s*"scripts"\s*,\s*"bridge"/);
assert.match(installSource, /process\.env\.CODEX_HOME \|\| homedir\(\)/);
assert.match(installSource, /preservedConfigs/);

for (const [script, expected] of [
  ["scripts/install-skill.mjs", "API Key 始终在安全提示中输入"],
  ["scripts/setup.mjs", "API Key 仍通过安全输入提示填写"],
]) {
  const result = spawnSync(process.execPath, [join(ROOT, script), "--help"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${script} --help should exit 0`);
  assert.match(result.stdout, new RegExp(expected));
}

const temp = mkdtempSync(join(os.tmpdir(), "avb-setup-test-"));
try {
  for (const file of ["setup.mjs", "provider-catalog.mjs", "config.example.json"]) {
    copyFileSync(join(ROOT, "scripts", file), join(temp, file));
  }
  const setup = spawnSync(process.execPath, [
    join(temp, "setup.mjs"), "--skill", "--provider", "zhipu", "--model", "glm-4.5v", "--skip-test",
  ], { input: "test-key-123456\n", cwd: temp, encoding: "utf8" });
  assert.equal(setup.status, 0, setup.stdout + setup.stderr);
  const config = JSON.parse(readFileSync(join(temp, "config.json"), "utf8"));
  assert.equal(config.provider, "zhipu");
  assert.equal(config.model, "glm-4.5v");
  assert.equal(config.bridge.enabled, false);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log("install flow tests passed");
