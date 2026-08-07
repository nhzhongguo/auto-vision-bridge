#!/usr/bin/env node
/**
 * uninstall.mjs - 安全卸载 Auto Vision Bridge
 *
 * 卸载范围：
 * - 停止由技能启动的本地 bridge（如果健康检查确认它是 vision-bridge）；
 * - 如果 Codex base_url 指向 bridge，则恢复到安装配置记录的 upstream；
 * - 将已安装技能移动到带时间戳的备份目录，而不是直接删除；
 * - 不删除仓库源代码、不删除用户的其他 Codex 配置。
 *
 * 用法：
 *   node scripts/uninstall.mjs       # 交互确认
 *   node scripts/uninstall.mjs --yes # 明确授权后一键卸载
 *   node scripts/uninstall.mjs --dry-run
 */
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const CODEX_HOME = process.env.CODEX_HOME || join(HOME, ".codex");
const SKILLS_DIR = join(CODEX_HOME, "skills");
const SKILL_DIR = join(SKILLS_DIR, "auto-vision-bridge");
const BACKUP_ROOT = join(SKILLS_DIR, "auto-vision-bridge-uninstall-backups");
const CODEX_CONFIG = join(CODEX_HOME, "config.toml");
const SKILL_CONFIG = join(SKILL_DIR, "scripts", "config.json");
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const YES = argv.includes("--yes");
const HELP = argv.includes("--help") || argv.includes("-h");

function printHelp() {
  console.log(`用法：
  node scripts/uninstall.mjs          交互确认后卸载
  node scripts/uninstall.mjs --yes   无交互安全卸载
  node scripts/uninstall.mjs --dry-run 仅预览，不修改文件
`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim().toLowerCase());
  }));
}

async function getBridgeHealth(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.service === "vision-bridge" ? body : null;
  } catch {
    return null;
  }
}

async function stopBridge(port, dryRun) {
  const health = await getBridgeHealth(port);
  if (!health?.pid) {
    console.log(`- bridge 未运行（端口 ${port}）`);
    return false;
  }

  console.log(`- 检测到 bridge：PID ${health.pid}，模型 ${health.visionModel || "未知"}`);
  if (dryRun) {
    console.log("  [dry-run] 将停止该 bridge");
    return true;
  }

  try {
    process.kill(Number(health.pid), "SIGTERM");
  } catch {
    // Windows 某些 detached Node 进程需要 taskkill；仅对已确认的 vision-bridge 使用。
    if (process.platform === "win32") {
      const { execFileSync } = await import("node:child_process");
      try {
        execFileSync("taskkill", ["/PID", String(health.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        console.log("  ⚠️ 无法自动停止 bridge，请手动结束 PID " + health.pid);
        return false;
      }
    } else {
      console.log("  ⚠️ 无法自动停止 bridge，请手动结束 PID " + health.pid);
      return false;
    }
  }

  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!(await getBridgeHealth(port))) {
      console.log("  bridge 已停止");
      return true;
    }
  }
  console.log("  ⚠️ bridge 进程仍可能运行，请检查端口 " + port);
  return false;
}

function restoreCodexBaseUrl(config, dryRun) {
  if (!existsSync(CODEX_CONFIG)) {
    console.log("- 未找到 Codex config.toml，跳过 base_url 还原");
    return false;
  }

  const bridge = config.bridge || {};
  const port = Number(bridge.port || 57399);
  const upstream = String(bridge.upstream || "").replace(/\/+$/, "");
  const text = readFileSync(CODEX_CONFIG, "utf8");
  const bridgeUrl = new RegExp(`https?://(?:127\\.0\\.0\\.1|localhost):${port}/v1/?$`, "i");
  const match = text.match(/^(\s*base_url\s*=\s*["'])([^"']+)(["'])(\s*(?:#[^\r\n]*)?)$/m);
  if (!match || !bridgeUrl.test(match[2])) {
    console.log("- Codex base_url 未指向此 bridge，跳过还原");
    return false;
  }
  if (!upstream) {
    console.log("  ⚠️ 检测到 base_url 指向 bridge，但没有记录 upstream，未修改 config.toml");
    return false;
  }

  const restored = upstream.endsWith("/v1") ? upstream : `${upstream}/v1`;
  console.log(`- 将 Codex base_url 还原为 ${restored}`);
  if (dryRun) {
    console.log("  [dry-run] 不写入 config.toml");
    return true;
  }

  const backup = `${CODEX_CONFIG}.before-auto-vision-uninstall-${timestamp()}.bak`;
  writeFileSync(backup, text, "utf8");
  const updated = text.replace(match[0], `${match[1]}${restored}${match[3]}${match[4]}`);
  writeFileSync(CODEX_CONFIG, updated, "utf8");
  console.log(`  已备份原 config.toml：${backup}`);
  return true;
}

function moveSkill(dryRun) {
  if (!existsSync(SKILL_DIR)) {
    console.log(`- 未找到已安装技能：${SKILL_DIR}`);
    return "";
  }
  mkdirSync(BACKUP_ROOT, { recursive: true });
  const base = join(BACKUP_ROOT, `auto-vision-bridge-${timestamp()}`);
  let target = base;
  let suffix = 1;
  while (existsSync(target)) target = `${base}-${suffix++}`;
  console.log(`- 将已安装技能移出：${SKILL_DIR}`);
  console.log(`  备份保留在：${target}`);
  if (!dryRun) renameSync(SKILL_DIR, target);
  return target;
}

async function main() {
  if (HELP) {
    printHelp();
    return;
  }
  console.log("==============================================");
  console.log("  Auto Vision Bridge - 安全卸载");
  console.log("==============================================\n");
  console.log("卸载会停止本地 bridge、还原 Codex base_url，并移除已安装技能。\n");
  console.log("不会删除仓库源代码；已安装目录会移动到备份目录，不会直接丢失。\n");

  if (!YES && !DRY_RUN) {
    const answer = await ask("确认卸载 Auto Vision Bridge？(y/N)：");
    if (answer !== "y" && answer !== "yes") {
      console.log("已取消，没有修改任何文件。");
      return;
    }
  }

  const config = readJson(SKILL_CONFIG);
  const port = Number(config.bridge?.port || 57399);
  await stopBridge(port, DRY_RUN);
  restoreCodexBaseUrl(config, DRY_RUN);
  moveSkill(DRY_RUN);

  console.log("\n卸载流程已完成。以后如需重新安装，从仓库运行：");
  console.log("  node scripts/install-skill.mjs --force");
  if (DRY_RUN) console.log("\n这是 dry-run，没有实际修改文件。");
}

main().catch((error) => {
  console.error("卸载失败：", error?.message || error);
  process.exitCode = 1;
});
