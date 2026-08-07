#!/usr/bin/env node
/**
 * Prepare a local open-source vision model through Ollama.
 * The model weights stay outside this repository and are downloaded locally.
 */
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const requested = argv[argv.indexOf("--model") + 1];
const model = requested && !requested.startsWith("--") ? requested : "moondream";

function run(args) {
  return spawnSync("ollama", args, { stdio: "inherit", shell: false, encoding: "utf8" });
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`用法：
  node scripts/install-local-model.mjs                 # 拉取默认 moondream
  node scripts/install-local-model.mjs --model qwen2.5vl:3b

前置：安装 Ollama，并确保 ollama 命令已加入 PATH。`);
  process.exit(0);
}

const version = run(["--version"]);
if (version.error || version.status !== 0) {
  console.error("未检测到 Ollama。请先从 https://ollama.com/download 安装 Ollama，并重新打开终端。");
  process.exit(1);
}

console.log(`正在准备本地视觉模型：${model}`);
const result = run(["pull", model]);
if (result.status !== 0) {
  console.error(`模型拉取失败：${model}`);
  process.exit(result.status ?? 1);
}

console.log(`本地视觉模型已准备完成：${model}`);
console.log("下一步：运行 node scripts/setup.mjs，选择“本地 Ollama 开源视觉模型”。");
