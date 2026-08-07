#!/usr/bin/env node
/**
 * install-skill.mjs - Vision Adapter Bridge 技能一键部署
 *
 * 用法：
 *   node scripts/install-skill.mjs          # 交互式全自动部署（推荐）
 *   node scripts/install-skill.mjs --yes    # 自动覆盖代码，保留已有 config.json
 *   node scripts/install-skill.mjs --force  # 强制覆盖已有技能和配置（仍不会覆盖 config.json）
 *   node scripts/install-skill.mjs --provider zhipu --model glm-4.6v
 *
 * 流程：
 *   1. 技能目标目录：~/.codex/skills/auto-vision-bridge/
 *   2. 备份旧技能（如有）
 *   3. 复制 SKILL.md + scripts/ + references/ + assets/ + agents/（自动排除本地 config.json、日志和备份）
 *   4. 运行 setup.mjs（只需选视觉服务商/模型并输入 Key）
 *   5. 运行 doctor.mjs --test（端到端体检，必须全 PASS）
 *   6. 输出「下一步」提示（包含一键卸载命令）
 */

import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const SKILL_SRC = REPO_ROOT;                    // 仓库根目录即技能源
const SKILL_DST = join(process.env.CODEX_HOME || homedir(), ".codex", "skills", "auto-vision-bridge");

const COPY_DIRS = ["scripts", "bridge", "references", "assets", "agents"];
const COPY_FILES = ["SKILL.md", ".gitignore"];
const COPY_EXCLUDED_BASENAMES = new Set(["config.json", "bridge.log"]);

function isSafeToCopy(source) {
  const name = basename(source);
  return !COPY_EXCLUDED_BASENAMES.has(name) && !name.endsWith(".bak") && !name.endsWith(".log");
}

const argv = process.argv.slice(2);
const AUTO_YES = argv.includes("--yes");
const FORCE = argv.includes("--force");
const HELP = argv.includes("--help") || argv.includes("-h");

function argValue(name) {
  const index = argv.indexOf(name);
  if (index < 0) return "";
  return String(argv[index + 1] || "").trim();
}

function printHelp() {
  console.log(`用法：
  node scripts/install-skill.mjs
  node scripts/install-skill.mjs --provider zhipu --model glm-4.6v
  node scripts/install-skill.mjs --yes --provider zhipu --model glm-4.6v

参数：
  --provider <id>  预选视觉服务商，例如 zhipu、siliconflow、gemini
  --model <id>     预选已登记的视觉模型，例如 glm-4.6v
  --yes            自动覆盖技能代码，但保留已有本地 config.json
  --force          强制覆盖技能代码；config.json 仍会先备份
  --skip-test      保存并体检配置，但跳过联网视觉请求
  --help           显示帮助

API Key 始终在安全提示中输入，不放在命令行参数里，也不会写入 git 跟踪文件。`);
}

if (HELP) {
  printHelp();
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question, fallback = "") {
  return new Promise((resolve) => {
    rl.question(question, (ans) => resolve(ans.trim() || fallback));
  });
}

function logStep(msg) { console.log(`\n\u001b[1;36m▶\u001b[0m ${msg}`); }
function logOk(msg) { console.log(`  \u001b[32m✔\u001b[0m ${msg}`); }
function logWarn(msg) { console.log(`  \u001b[33m⚠\u001b[0m ${msg}`); }
function logErr(msg) { console.error(`  \u001b[31m✖\u001b[0m ${msg}`); }

async function confirmOverwrite() {
  if (FORCE) return true;
  if (AUTO_YES) return true; // --yes 自动覆盖代码，config.json 不在复制清单中，会保留
  if (!existsSync(SKILL_DST)) return true;

  const yn = await ask(
    `\n检测到已安装技能：${SKILL_DST}\n是否覆盖安装？(y=覆盖 / n=保留现有并退出，默认 n)：`,
    "n"
  );
  return yn.toLowerCase() === "y" || yn.toLowerCase() === "yes";
}

function copySkill() {
  logStep(`复制技能到 ${SKILL_DST}`);

  // 确保目标目录存在
  mkdirSync(SKILL_DST, { recursive: true });

  // 复制目录，并保留本地已有 config.json（scripts/ 与 bridge/ 都可能配置过 Key）
  for (const d of COPY_DIRS) {
    const src = join(SKILL_SRC, d);
    const dst = join(SKILL_DST, d);
    if (existsSync(src)) {
      const preservedConfigs = new Map();
      if (existsSync(dst)) {
        for (const rel of ["scripts/config.json", "bridge/config.json"]) {
          const localConfig = join(SKILL_DST, rel);
          if (existsSync(localConfig)) {
            preservedConfigs.set(rel, readFileSync(localConfig, "utf8"));
          }
        }
      }
      if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
      cpSync(src, dst, { recursive: true, filter: isSafeToCopy });
      for (const [rel, content] of preservedConfigs) {
        writeFileSync(join(SKILL_DST, rel), content, "utf8");
        logOk(`已保留本地 ${rel}`);
      }
      logOk(`已复制 ${d}/`);
    } else {
      logWarn(`源目录不存在，跳过：${src}`);
    }
  }

  // 复制文件
  for (const f of COPY_FILES) {
    const src = join(SKILL_SRC, f);
    const dst = join(SKILL_DST, f);
    if (existsSync(src)) {
      writeFileSync(dst, readFileSync(src, "utf8"), "utf8");
      logOk(`已复制 ${f}`);
    } else {
      logWarn(`源文件不存在，跳过：${src}`);
    }
  }
}

function runScript(scriptName, args = []) {
  const scriptPath = join(SKILL_DST, "scripts", scriptName);
  if (!existsSync(scriptPath)) {
    logErr(`脚本不存在：${scriptPath}`);
    return { code: 1, stdout: "", stderr: "script not found" };
  }
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: SKILL_DST,
    stdio: "inherit",
    encoding: "utf8",
    shell: false,
  });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function main() {
  console.log("==============================================");
  console.log("  Vision Adapter Bridge - 技能一键部署");
  console.log("  克隆 → 导入技能 → 配置视觉模型 → 体检 → 完成");
  console.log("==============================================\n");

  // 1. 确认覆盖
  if (!(await confirmOverwrite())) {
    console.log("\n已取消，保留现有技能。");
    rl.close();
    process.exit(0);
  }

  // 2. 复制技能
  try {
    copySkill();
  } catch (e) {
    logErr(`复制失败：${e.message}`);
    rl.close();
    process.exit(1);
  }

  // 3. 运行 setup.mjs（交互式配置）
  logStep("启动配置向导（选择视觉服务商、输入 API Key）");
  const setupArgs = ["--skill"];
  const provider = argValue("--provider");
  const model = argValue("--model");
const SKIP_TEST = argv.includes("--skip-test");
  if (provider) setupArgs.push("--provider", provider);
  if (model) setupArgs.push("--model", model);
  if (AUTO_YES && !SKIP_TEST) setupArgs.push("--test");
  if (SKIP_TEST) setupArgs.push("--skip-test");
  const setupResult = runScript("setup.mjs", setupArgs);
  if (setupResult.code !== 0) {
    logErr("配置向导失败或被取消。");
    rl.close();
    process.exit(1);
  }

  // 4. 运行 doctor.mjs（默认端到端体检；--skip-test 时不发送联网视觉请求）
  logStep("运行体检（验证 Key、模型、配置）");
  const doctorArgs = SKIP_TEST ? [] : ["--test"];
  const doctorResult = runScript("doctor.mjs", doctorArgs);
  if (doctorResult.code !== 0) {
    logErr("体检未通过，请根据上面的 FAIL 项修复后重跑：");
    console.log(`  cd ${SKILL_DST}`);
    console.log(`  node scripts/doctor.mjs${SKIP_TEST ? "" : " --test"}`);
    rl.close();
    process.exit(1);
  }

  // 5. 交付说明
  console.log("\n==============================================");
  console.log("\u001b[1;32m🎉 部署成功！\u001b[0m");
  console.log("==============================================");
  console.log("\n技能已安装到：");
  console.log(`  ${SKILL_DST}`);
  console.log("\n以后遇到 \u001b[1m不支持视觉的模型\u001b[0m（如 DeepSeek、Kimi、GLM 文本版）收到图片时，");
  console.log("Codex 会 \u001b[1m自动调用技能\u001b[0m 把图片识别成文字，再用当前模型正常回答。");
  console.log("\n\u001b[1m无需做的事：\u001b[0m");
  console.log("  ❌ 不需要启动常驻服务");
  console.log("  ❌ 不需要改 client base_url（技能模式）");
  console.log("  ❌ 不需要配置上游中转地址");
  console.log("\n\u001b[1m如需卸载视觉功能：\u001b[0m");
  console.log(`  cd ${SKILL_DST}`);
  console.log("  node scripts/uninstall.mjs --yes");
  console.log("  也可以直接在当前对话发送：我要卸载（由 AI 执行同一安全卸载流程）");
  console.log("\n\u001b[1m如需手动测试识图：\u001b[0m");
  console.log(`  cd ${SKILL_DST}`);
  console.log('  node scripts/analyze_image.mjs --image "图片路径" --prompt "你的问题"');
  console.log("\n\u001b[1m如需启用透明中转模式（常驻 bridge，所有请求自动拦截识图）：\u001b[0m");
  console.log(`  cd ${SKILL_DST}`);
  console.log("  node scripts/setup.mjs     # 重新配置，选择启用 bridge");
  console.log("  node scripts/start-bridge.mjs");
  console.log("  # 再把 Codex config.toml 的 base_url 改为 http://127.0.0.1:57399/v1 并重启客户端");
  console.log("\n\u001b[1m配置文件位置（API Key 只存这里，不进 git）：\u001b[0m");
  console.log(`  ${join(SKILL_DST, "scripts", "config.json")}`);
  console.log("\n==============================================\n");

  rl.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("\n部署异常：", e.message);
  rl.close();
  process.exit(1);
});
