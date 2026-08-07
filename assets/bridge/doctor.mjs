#!/usr/bin/env node
/**
 * doctor.mjs —— Vision Adapter Bridge 一键体检（AI 部署验收用）
 * ---------------------------------------------------------------
 * 用法：
 *   node bridge/doctor.mjs                                   # 检查本仓库副本的部署
 *   node bridge/doctor.mjs --config 路径/config.json         # 检查指定实例（例如实际运行的 .codex/vision-bridge）
 *   node bridge/doctor.mjs --model 模型名                    # 指定测试模型名（默认读 config.toml / deepseek-v4-flash）
 *   node bridge/doctor.mjs --port 57399                      # 手动指定 bridge 端口
 *
 * 检查项：
 *   1) Node 版本 >= 18
 *   2) bridge/config.json 存在且视觉 Key 已配置（不泄露完整 Key）
 *   3) bridge 服务 /health 可达
 *   4) 带图请求端到端：bridge 调视觉模型识图 -> 上游模型正常回答
 *   5) 无图请求透传正常
 *   6) 客户端接线：Codex 的 config.toml 里 base_url 已指向 bridge
 *   7) 模型目录放行：cc-switch 模型目录里当前模型 input_modalities 含 image
 *
 * 退出码：0 = 全部通过（AI 可交付）；1 = 有项未过（AI 必须修复后重跑）。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import http from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DEFAULT_CONFIG = join(HERE, "config.json");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const configPath = arg("--config", DEFAULT_CONFIG);
const results = [];
function render(name, ok, detail, warnFlag = false) {
  const icon = warnFlag ? "⚠️" : ok === true ? "✅" : ok === false ? "❌" : "⏭️";
  const tag = warnFlag ? "WARN" : ok === true ? "PASS" : ok === false ? "FAIL" : "SKIP";
  console.log(`${icon} [${tag}] ${name}${detail ? "  —  " + detail : ""}`);
}
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  render(name, ok, detail);
}
function warn(name, detail = "") {
  results.push({ name, ok: null, detail, warn: true });
  render(name, null, detail, true);
}

/* ---------- 1. Node 版本 ---------- */
const nodeVer = process.versions.node;
const [maj] = nodeVer.split(".").map(Number);
check("Node.js >= 18", maj >= 18, `当前 v${nodeVer}`);

/* ---------- 2. config.json + Key ---------- */
let cfg = null;
if (!existsSync(configPath)) {
  check("bridge/config.json 存在", false, `未找到 ${configPath}（复制 config.example.json 为 config.json，或用 node scripts/setup.mjs 生成）`);
} else {
  try {
    cfg = JSON.parse(readFileSync(configPath, "utf8"));
    const key = cfg.visionApiKey || cfg.zhipuApiKey || "";
    const masked = key.length >= 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "(空)";
    check("config.json 可解析", true, configPath);
    check("视觉 API Key 已配置", key.length > 8, `visionApiKey=${masked}`);
    check("upstream 已配置", !!(cfg.upstream && /^https?:\/\//.test(cfg.upstream)), `upstream=${cfg.upstream}`);
    const vm = String(cfg.visionModel || "").trim();
    if (!vm) {
      check("visionModel 已配置", false, "config.json 缺少 visionModel 字段（请用 node scripts/setup.mjs 配置）");
    } else if (
      /(vl|vision|omni|multimodal|4v|4\.6v|llava|internvl|minicpm|glm-4v|step-1v|spark|doubao|hunyuan|qwen3-vl|qwen2\.5-vl)/i.test(vm) ||
      /(^|[^a-z])(4o|4\.1|4\.5|o1|o3|o4|o5|claude|gemini|gpt-5)/i.test(vm) ||
      /(^|[^a-z])v$/.test(vm)
    ) {
      check("visionModel 应为视觉模型", true, `visionModel=${vm}`);
    } else {
      warn("visionModel 名称不像视觉模型", `visionModel=${vm} 缺少 VL/vision/4v 等标记，纯文本模型无法识图。硅基流动建议 Qwen/Qwen2.5-VL-7B-Instruct，智谱建议 glm-4.6v。确为视觉模型可忽略此警告，以「带图端到端」实测为准。`);
    }
  } catch (e) {
    check("config.json 可解析", false, `解析失败：${e.message}`);
  }
}

const port = Number(arg("--port", (cfg && cfg.port) || 57399));
const BASE = `http://127.0.0.1:${port}`;

// 上游可能强制鉴权：优先读 Codex config.toml 的 experimental_bearer_token，
// 没有则用占位 Key 并提示（否则带图/透传测试会被上游 401 拦下，误判为 bridge 故障）。
function upstreamAuth() {
  try {
    const home = process.env.CODEX_HOME || join(os.homedir(), ".codex");
    const toml = readFileSync(join(home, "config.toml"), "utf8");
    const m = toml.match(/experimental_bearer_token\s*=\s*"([^"]+)"/);
    if (m && m[1]) return `Bearer ${m[1]}`;
  } catch {}
  console.warn("[提示] config.toml 未配置 experimental_bearer_token，使用占位 Key 测试；上游强制鉴权时会 401。");
  return "Bearer doctor";
}
const AUTH = upstreamAuth();

function fetchJson(path, body, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json", authorization: AUTH } : {} },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, text: data }));
      },
    );
    req.on("error", (e) => resolve({ status: 0, text: "", error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("timeout")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/* ---------- 3. 服务健康 ---------- */
const health = await fetchJson("/health", null, 10000);
check("bridge 服务 /health 可达", health.status === 200 && /"ok"\s*:\s*true/.test(health.text), health.status === 200 ? `GET ${BASE}/health -> 200` : (health.error ? `连接失败：${health.error}` : `HTTP ${health.status} ${health.text.slice(0, 120)}`));

/* ---------- 4. 带图端到端 ---------- */
const tomlModel = (() => {
  const home = process.env.CODEX_HOME || join(os.homedir(), ".codex");
  const p = join(home, "config.toml");
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf8").match(/^\s*model\s*=\s*["']([^"']+)["']/m);
  return m ? m[1] : null;
})();
const model = arg("--model", tomlModel || (cfg && cfg.testModel) || "deepseek-v4-flash");
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let imageOk = false, imageDetail = "";
if (health.status === 200) {
  const r = await fetchJson("/v1/responses", {
    model,
    input: [
      { type: "message", role: "user", content: [
        { type: "input_text", text: "这是一张测试图。看到就回答：OK" },
        { type: "input_image", image_url: `data:image/png;base64,${TINY_PNG_B64}` },
      ] },
    ],
    stream: false,
  }, 90000);
  imageOk = r.status === 200 && !/MODEL_CAPABILITY_NOT_SUPPORTED|不支持该能力/.test(r.text);
  if (r.status === 200) {
    const m = r.text.match(/"type"\s*:\s*"output_text"[\s\S]*?"text"\s*:\s*"([^"]{0,120})/);
    imageDetail = `模型 ${model} 回答：${m ? m[1].replace(/\\n/g, " ") : "(无 output_text，请人工查看)"}`;
  } else if (r.status === 0) {
    imageDetail = `请求失败：${r.error}`;
  } else {
    const em = r.text.match(/"message"\s*:\s*"([^"]{0,160})/);
    imageDetail = `HTTP ${r.status}：${em ? em[1] : r.text.slice(0, 160)}`;
  }
  check("带图端到端（识图转文字）", imageOk, imageDetail);
} else {
  check("带图端到端（识图转文字）", false, "跳过：bridge 未启动");
}

/* ---------- 5. 无图透传 ---------- */
if (health.status === 200) {
  const r = await fetchJson("/v1/responses", {
    model,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "回一个字：好" }] }],
    stream: false,
  }, 60000);
  const textOk = r.status === 200;
  const textDetail = r.status === 200 ? `HTTP 200` : (r.status === 0 ? `请求失败：${r.error}` : `HTTP ${r.status} ${r.text.slice(0, 120)}`);
  check("无图请求透传", textOk, textDetail);
} else {
  check("无图请求透传", false, "跳过：bridge 未启动");
}

/* ---------- 6. 客户端接线（Codex config.toml） ---------- */
const codexHome = process.env.CODEX_HOME || join(os.homedir(), ".codex");
const tomlPath = join(codexHome, "config.toml");
const clientLines = [];
if (existsSync(tomlPath)) {
  const lines = readFileSync(tomlPath, "utf8").split(/\r?\n/);
  for (const ln of lines) {
    const m = ln.match(/^\s*base_url\s*=\s*["']([^"']+)["']/);
    if (m) clientLines.push(m[1]);
  }
  const bridgeUrl = `${BASE}/v1`;
  const clientOk = clientLines.some((u) => u.replace(/\/+$/, "") === bridgeUrl.replace(/\/+$/, ""));
  const clientDetail = clientLines.length ? clientLines.join(" | ") : "(未找到 base_url)";
  if (clientOk) {
    check("客户端接线：base_url 指向 bridge", true, `${tomlPath} → ${bridgeUrl}`);
  } else {
    check("客户端接线：base_url 指向 bridge", false, `${tomlPath} 当前：${clientDetail}；应改为 ${bridgeUrl} 并重启客户端`);
  }
} else {
  check("客户端接线：base_url 指向 bridge", null, `未找到 ${tomlPath}（跳过：非 Codex 客户端或未使用默认路径）`);
}

/* ---------- 7. 模型目录放行（cc-switch） ---------- */
const catRel = (() => {
  if (!existsSync(tomlPath)) return null;
  const m = readFileSync(tomlPath, "utf8").match(/^\s*model_catalog_json\s*=\s*["']([^"']+)["']/m);
  return m ? m[1] : null;
})();
const catPath = catRel ? (isAbsolute(catRel) || catRel.includes(":") ? catRel : join(codexHome, catRel)) : null;
if (catPath && existsSync(catPath)) {
  try {
    const cat = JSON.parse(readFileSync(catPath, "utf8"));
    const entry = (cat.models || []).find((x) => x.slug === tomlModel || x.id === tomlModel);
    if (entry) {
      const mods = Array.isArray(entry.input_modalities) ? entry.input_modalities : [];
      const catalogOk = mods.includes("image");
      check("模型目录放行图片输入", catalogOk, `${catPath} model=${tomlModel} input_modalities=[${mods.join(",")}]`);
    } else {
      check("模型目录放行图片输入", null, `目录中未找到模型 ${tomlModel}（跳过）`);
    }
  } catch (e) {
    check("模型目录放行图片输入", null, `目录解析失败：${e.message}（跳过）`);
  }
} else {
  check("模型目录放行图片输入", null, "未使用 cc-switch 模型目录（跳过：通用客户端无需此项）");
}

/* ---------- 汇总 ---------- */
console.log("\n" + "=".repeat(62));
const fails = results.filter((r) => r.ok === false);
const passes = results.filter((r) => r.ok === true);
const warns = results.filter((r) => r.warn);
const skips = results.filter((r) => r.ok === null && !r.warn);
console.log(`体检结果：PASS ${passes.length} / FAIL ${fails.length} / SKIP ${skips.length}${warns.length ? ` / WARN ${warns.length}` : ""}`);
if (warns.length) console.log(`⚠️ 有 ${warns.length} 项警告：不影响交付判定，但请核对提示内容。`);
if (fails.length === 0) {
  console.log("🎉 全部通过！可以交付：客户端 base_url 已指向 bridge（若第 6 项被跳过，请确认客户端配置）。");
  process.exit(0);
} else {
  console.log("⚠️ 有 FAIL 项：AI 必须逐项修复后重新运行本脚本，直到全部 PASS 才能交付。");
  process.exit(1);
}
