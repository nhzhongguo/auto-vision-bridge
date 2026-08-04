#!/usr/bin/env node
/**
 * start-bridge.mjs - 启动透明中转 bridge（可选模式）
 *
 * 用法：node scripts/start-bridge.mjs
 * 前置：先运行 node scripts/setup.mjs 并启用 bridge 模式
 */
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import net from "node:net";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SKILL_CONFIG = join(HERE, "config.json");
const SOURCE_BRIDGE_DIR = join(ROOT, "bridge");
const PACKAGED_BRIDGE_DIR = join(ROOT, "assets", "bridge");
const BRIDGE_DIR = existsSync(join(SOURCE_BRIDGE_DIR, "server.mjs")) ? SOURCE_BRIDGE_DIR : PACKAGED_BRIDGE_DIR;
const BRIDGE_CONFIG = join(BRIDGE_DIR, "config.json");
const SERVER = join(BRIDGE_DIR, "server.mjs");

if (!existsSync(SKILL_CONFIG)) {
  console.error("未找到 config.json，先运行 node scripts/setup.mjs");
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(SKILL_CONFIG, "utf8"));
const bridge = cfg.bridge || {};
const port = bridge.port || 57399;
const upstream = bridge.upstream || "http://127.0.0.1:57321";
if (!cfg.apiKey) {
  console.error("未配置视觉 API Key，先运行 node scripts/setup.mjs");
  process.exit(1);
}

function listening(p) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: "127.0.0.1", port: p });
    s.on("connect", () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
  });
}

if (await listening(port)) {
  console.log(`bridge 已在 ${port} 端口运行`);
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
    const ok = health.ok && (await health.json())?.ok === true;
    console.log(ok ? "健康检查通过" : "/health 异常，请检查进程");
    process.exit(ok ? 0 : 1);
  } catch {
    console.log("端口占用但 /health 未响应，请检查进程");
    process.exit(1);
  }
}

mkdirSync(BRIDGE_DIR, { recursive: true });
writeFileSync(
  BRIDGE_CONFIG,
  JSON.stringify(
    {
      listen: bridge.listen || "127.0.0.1",
      port,
      upstream,
      visionProvider: "zhipu",
      visionApiKey: cfg.apiKey,
      visionBaseUrl: cfg.baseUrl,
      visionModel: cfg.model,
      visionPrompt: cfg.prompt,
    },
    null,
    2,
  ),
  "utf8",
);

const logFile = join(BRIDGE_DIR, "bridge.log");
const logFd = openSync(logFile, "a");
const child = spawn(process.execPath, [SERVER], {
  cwd: BRIDGE_DIR,
  detached: true,
  windowsHide: true,
  stdio: ["ignore", logFd, logFd],
});
closeSync(logFd);
child.unref();

for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    const ok = health.ok && (await health.json())?.ok === true;
    if (ok) {
      console.log(`bridge 已启动：http://127.0.0.1:${port}`);
      console.log(`把 Codex config.toml 的 base_url 改为 http://127.0.0.1:${port}/v1 并重启客户端`);
      process.exit(0);
    }
  } catch {
    // keep polling
  }
}
console.error(`bridge 启动后健康检查超时，查看 ${logFile}`);
process.exit(1);
