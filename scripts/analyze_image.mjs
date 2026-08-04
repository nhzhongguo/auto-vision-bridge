#!/usr/bin/env node
/**
 * analyze_image.mjs - 调用视觉大模型把图片转成文字描述
 *
 * 用法：
 *   node scripts/analyze_image.mjs --image <本地路径|URL|data URI> [--prompt "问题"]
 *                                  [--config config.json] [--model 模型] [--json]
 *
 * 配置优先级：命令行 > 环境变量(VISION_API_KEY/VISION_BASE_URL/VISION_MODEL) > config.json
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = join(HERE, "config.json");

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
};
const image = flag("--image") || flag("-i");
const promptArg = flag("--prompt") || flag("-p");
const configPath = flag("--config") || DEFAULT_CONFIG;
const jsonOut = argv.includes("--json");
const force = argv.includes("--force");
const maxChars = Number(flag("--max-chars") || 0);
const timeoutMs = Number(flag("--timeout-ms") || 0);

const VISION_MARKER =
  /(vl|vision|omni|multimodal|4v|4o|4\.1|4\.5|o1|o3|o4|o5|claude|gemini|llava|internvl|minicpm|step-1v|spark|doubao|hunyuan|glm-4v|glm-4\.6v)/i;
function looksLikeVisionModel(name) {
  return VISION_MARKER.test(name) || /(^|[^a-z])v$/i.test(name.trim());
}

function out(payload) {
  process.stdout.write(jsonOut ? JSON.stringify(payload, null, 2) + "\n" : payload.text + "\n");
}
function fail(message) {
  if (jsonOut) process.stdout.write(JSON.stringify({ ok: false, error: message }, null, 2) + "\n");
  else process.stderr.write(`[analyze_image] ${message}\n`);
  process.exit(1);
}

if (!image) {
  fail('缺少 --image 参数。示例：node scripts/analyze_image.mjs --image "C:\\path\\image.png" --prompt "图里有什么"');
}

let cfg = {};
if (existsSync(configPath)) {
  try {
    cfg = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    fail(`config.json 解析失败（${configPath}）：${e.message}`);
  }
}

const apiKey = flag("--api-key") || process.env.VISION_API_KEY || cfg.apiKey || cfg.zhipuApiKey || "";
const baseUrl = flag("--base-url") || process.env.VISION_BASE_URL || cfg.baseUrl || cfg.visionBaseUrl || "";
const model = flag("--model") || process.env.VISION_MODEL || cfg.model || cfg.visionModel || "";
const prompt = promptArg || cfg.prompt || "请完整描述这张图片：可见文字（OCR）、主体、场景、布局、颜色。用中文回答。";

if (!apiKey) fail("未配置视觉 API Key。运行 node scripts/setup.mjs，或设置 VISION_API_KEY。");
if (!baseUrl) fail("未配置视觉 API 地址。运行 node scripts/setup.mjs，或设置 VISION_BASE_URL。");
if (!model) fail("未配置视觉模型名。运行 node scripts/setup.mjs，或设置 VISION_MODEL。");
if (!force && !looksLikeVisionModel(model)) {
  process.stderr.write(
    `[analyze_image] 警告：${model} 不像视觉模型（缺少 vl/vision/4v/omni 等标记）。如果确认它支持图片输入，加 --force 跳过检查。\n`,
  );
}

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

async function toDataUri(input) {
  if (/^data:/i.test(input)) return input;
  if (/^https?:\/\//i.test(input)) {
    const resp = await fetch(input);
    if (!resp.ok) throw new Error(`下载图片失败 HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const mime = (resp.headers.get("content-type") || "").split(";")[0] || "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  const path = input.replace(/^file:\/\//i, "");
  if (!existsSync(path)) throw new Error(`图片文件不存在：${path}`);
  const buf = readFileSync(path);
  const ext = (path.match(/\.[^.\\/]+$/) || [""])[0].toLowerCase();
  return `data:${MIME[ext] || "image/png"};base64,${buf.toString("base64")}`;
}

let dataUri;
try {
  dataUri = await toDataUri(image);
} catch (e) {
  fail(`读取图片失败：${e.message}`);
}

const body = {
  model,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUri } },
      ],
    },
  ],
  max_tokens: cfg.maxTokens || 1024,
  temperature: cfg.temperature ?? 0.2,
};

let resp;
try {
  resp = await fetch(baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs || cfg.timeoutMs || 120000),
  });
} catch (e) {
  fail(`请求视觉模型失败：${e.message}`);
}
const raw = await resp.text();
if (!resp.ok) {
  const hint =
    resp.status === 401 ? "（Key 无效或未配置，运行 node scripts/setup.mjs）" :
    resp.status === 402 ? "（服务商余额不足，充值或换服务商）" :
    resp.status === 429 ? "（触发限流，稍后重试）" :
    resp.status === 400 ? "（模型名错误或模型不支持图片，确认 visionModel 是视觉模型，例如 glm-4.6v / Qwen2.5-VL）" : "";
  fail(`视觉模型 HTTP ${resp.status}${hint}：${raw.slice(0, 300)}`);
}

let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  fail(`视觉模型返回不是 JSON：${raw.slice(0, 300)}`);
}

const content = data?.choices?.[0]?.message?.content;
let text = Array.isArray(content)
  ? content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("\n")
  : String(content ?? "");
text = text.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, "").trim();
if (!text) fail("视觉模型返回内容为空。请让用户确认：1) 模型确实支持图片输入；2) 服务商返回正常。参考 references/providers.md 换用 glm-4.6v 或 Qwen2.5-VL。");

const limit = maxChars || cfg.maxDescChars || 4000;
if (text.length > limit) text = text.slice(0, limit) + "\n…（已截断）";
out({ ok: true, text, model, provider: baseUrl, usage: data?.usage || null });
