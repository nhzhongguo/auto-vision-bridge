#!/usr/bin/env node
/**
 * vision-bridge —— DeepSeek 自动看图中转层
 * ------------------------------------------------------------------
 * 作用：让不支持视觉的模型也能看图。
 *   Codex 把图片发给本服务(127.0.0.1:57399) -> 自动调智谱 GLM-4.6V
 *   识别成文字描述 -> 替换请求里的图片 -> 转发给上游 DeepSeek 中转。
 * 零依赖：只用 Node 原生 http + fetch（Node 18+ 可用）。
 *
 * 启动：  node server.mjs
 * 健康检查：GET http://127.0.0.1:57399/health
 * 配置：  config.json（同目录）
 */
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(ROOT, "config.json");

const DEFAULT_CONFIG = {
  listen: "127.0.0.1",
  port: 57399,
  upstream: "http://127.0.0.1:57321",
  zhipuApiKey: "",
  visionModel: "glm-4.6v",
  visionPrompt:
    "这是一张用户发送的图片。请完整描述图片内容，包括：1) 图中所有可见文字（OCR，原样输出并注意排版）；2) 场景与主体；3) 物体、人物、动作、布局；4) 颜色与风格。用中文回答。",
  logFile: join(ROOT, "bridge.log"),
  visionTimeoutMs: 60000,
  maxDescChars: 4000,
  cacheSize: 300,
  // 明确支持视觉的模型关键词（命中则图片原样透传）
  visionModels: [
    "gpt-4o", "gpt-4.1", "gpt-5", "o1", "o3", "o4", "o5",
    "claude", "gemini",
    "qwen-vl", "qwen2.5-vl", "qwen3-vl",
    "glm-4v", "glm-4.5v", "glm-4.6v",
    "llava", "internvl", "minicpm-v", "step-1v", "spark-vision", "doubao-vision", "hunyuan-vision"
  ],
  // 明确不支持视觉的模型关键词（命中则自动转文字；deepseek 系列）
  nonVisionModels: [
    "deepseek", "kimi", "moonshot", "ernie", "baichuan", "minimax",
    "glm-4-flash", "glm-4-air", "glm-4-plus", "glm-4-long", "glm-4-0520",
    "qwen-turbo", "qwen-plus", "qwen-max", "qwen-long", "qwen-lite"
  ],
};

let cfg = { ...DEFAULT_CONFIG };
try {
  cfg = { ...cfg, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
} catch (e) {
  console.error(`[vision-bridge] 配置加载失败，使用默认值：${e.message}`);
}
cfg.logFile = cfg.logFile || join(ROOT, "bridge.log");

/* ---------------- 日志 ---------------- */
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    appendFileSync(cfg.logFile, line + "\n");
  } catch {}
}

/* ---------------- 图片描述缓存（同图不重复调用） ---------------- */
const cache = new Map(); // sha256(url) -> 描述
function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}
function cachePut(url, text) {
  const k = sha256(url);
  cache.set(k, text);
  if (cache.size > cfg.cacheSize) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}
function cacheGet(url) {
  const k = sha256(url);
  return cache.has(k) ? cache.get(k) : null;
}

/* ---------------- 扫描请求里的图片 ---------------- */
/**
 * 递归遍历 JSON，收集所有图片位置。
 * 支持：
 *  - Responses API:  {type:"input_image", image_url:"data:..."}
 *  - Chat API:       {type:"image_url", image_url:{url:"..."}} 或 {image_url:"data:..."}
 *  - 文本里的 Markdown:  ![](data:...) / ![](https://...)
 */
function walk(node, parent, key, state) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walk(node[i], node, i, state);
    return;
  }
  if (node && typeof node === "object") {
    const t = node.type;
    if (t === "input_image" || t === "image_url") {
      const url =
        typeof node.image_url === "string"
          ? node.image_url
          : node.image_url && typeof node.image_url.url === "string"
            ? node.image_url.url
            : typeof node.url === "string"
              ? node.url
              : null;
      if (url && /^(data:image|https?:\/\/)/i.test(url)) {
        state.found.push({ parent, key, url, kind: "obj" });
        return;
      }
    }
    if (!t && typeof node.image_url === "string" && /^data:image/i.test(node.image_url)) {
      state.found.push({ parent, key, url: node.image_url, kind: "obj" });
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, node, k, state);
    return;
  }
  if (typeof node === "string") {
    const re = /!\[[^\]]*\]\((data:image\/[^)\s]+|https?:\/\/[^)\s]+)\)/g;
    const marks = [];
    let m;
    while ((m = re.exec(node)) !== null) {
      marks.push({ start: m.index, end: m.index + m[0].length, url: m[1] });
    }
    if (marks.length) state.found.push({ parent, key, markdown: marks, kind: "text" });
  }
}

/* ---------------- 调智谱视觉模型 ---------------- */
/* ---------------- 判断模型是否支持视觉 ---------------- */
function modelSupportsVision(model) {
  const m = String(model || "").toLowerCase().trim();
  if (!m) return false; // 没有模型名 -> 默认转换（保证能用）
  // 1) 白名单：明确支持多模态
  if ((cfg.visionModels || []).some((x) => m.includes(String(x).toLowerCase()))) return true;
  // 2) 黑名单：明确不支持
  if ((cfg.nonVisionModels || []).some((x) => m.includes(String(x).toLowerCase()))) return false;
  // 3) 启发式：名字明显带视觉能力
  if (/(vl|vision|omni|multimodal)/.test(m)) return true;
  if (/(^|[^a-z])(4o|o1|o3|o4|o5|claude|gemini)/.test(m)) return true;
  if (/(^|[^a-z])v$/.test(m)) return true; // 以 -v/4v 结尾，如 glm-4.6v
  // 4) 未知模型 -> 按不支持处理，自动转文字（最稳妥，不会报错）
  return false;
}
async function describeImage(url) {
  if (!cfg.zhipuApiKey) throw new Error("未配置 zhipuApiKey，无法自动识别图片");
  const payload = {
    model: cfg.visionModel,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url } },
          { type: "text", text: cfg.visionPrompt },
        ],
      },
    ],
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.visionTimeoutMs);
  try {
    const visionUrl = cfg.visionBaseUrl || "https://open.bigmodel.cn/api/paas/v4/chat/completions";
    const resp = await fetch(visionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.zhipuApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!resp.ok) throw new Error(`智谱 HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json();
    let text = data?.choices?.[0]?.message?.content ?? "";
    if (Array.isArray(text)) {
      text = text
        .map((p) => (typeof p === "string" ? p : p?.text ?? ""))
        .join("")
        .trim();
    }
    if (!text) throw new Error("智谱返回空内容");
    return String(text).trim();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 替换图片为文字 ---------------- */
function labelFor(urls, url, descs) {
  const idx = urls.indexOf(url) + 1;
  let d = (descs.get(url) || "").trim().replace(/\s+/g, " ");
  if (d.length > cfg.maxDescChars) d = d.slice(0, cfg.maxDescChars) + "…";
  return `[图片${idx}: ${d}]`;
}

async function processBody(body) {
  const state = { found: [] };
  walk(body, null, null, state);
  if (!state.found.length) return { body, imageCount: 0, replaced: 0, fromCache: 0 };

  // 去重收集所有图片 URL
  const urls = [];
  const seen = new Set();
  const collect = (u) => {
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };
  for (const f of state.found) {
    if (f.kind === "obj") collect(f.url);
    else for (const m of f.markdown) collect(m.url);
  }

  // 逐张识别（缓存命中则不调 API）
  const descs = new Map();
  let fromCache = 0;
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    const hit = cacheGet(u);
    if (hit !== null) {
      descs.set(u, hit);
      fromCache++;
      log(`[图片 ${i + 1}/${urls.length}] 命中缓存`);
      continue;
    }
    try {
      const t = await describeImage(u);
      descs.set(u, t);
      cachePut(u, t);
      log(`[图片 ${i + 1}/${urls.length}] 识别成功（${t.length} 字）`);
    } catch (e) {
      descs.set(u, `[图片识别失败：${e.message}]`);
      log(`[图片 ${i + 1}/${urls.length}] 识别失败：${e.message}`);
    }
  }

  // 原位替换
  let replaced = 0;
  for (const f of state.found) {
    if (f.kind === "obj") {
      const isResp =
        Array.isArray(f.parent) &&
        f.parent.some(
          (i) => i && typeof i === "object" && (i.type === "input_text" || i.type === "input_image"),
        );
      const repl = isResp
        ? { type: "input_text", text: labelFor(urls, f.url, descs) }
        : { type: "text", text: labelFor(urls, f.url, descs) };
      f.parent[f.key] = repl;
      replaced++;
    } else {
      const orig = f.parent[f.key];
      let out = "";
      let last = 0;
      for (const m of f.markdown) {
        out += orig.slice(last, m.start);
        out += labelFor(urls, m.url, descs);
        last = m.end;
      }
      out += orig.slice(last);
      f.parent[f.key] = out;
      replaced++;
    }
  }
  return { body, imageCount: urls.length, replaced, fromCache };
}

/* ---------------- HTTP 服务 ---------------- */
const server = http.createServer(async (req, res) => {
  const start = Date.now();
  const path = req.url || "/";
  try {
    // 健康检查
    if (req.method === "GET" && (path === "/health" || path === "/healthz")) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "vision-bridge",
          pid: process.pid,
          uptimeSec: Math.round(process.uptime()),
          cacheSize: cache.size,
          upstream: cfg.upstream,
          visionModel: cfg.visionModel,
        }),
      );
      return;
    }

    // 读请求体
    let raw = "";
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 100 * 1024 * 1024) break; // 100MB 上限，防止内存撑爆
      }
    }

    // 解析并替换图片
    let body = null;
    let imageCount = 0;
    let fromCache = 0;
    if (raw) {
      try {
        body = JSON.parse(raw);
        const model = body?.model ?? "";
        if (modelSupportsVision(model)) {
          log(`模型 "${model}" 支持多模态，图片原样透传（不转换）`);
        } else {
          if (model) log(`模型 "${model}" 不支持视觉，自动转换图片`);
          const r = await processBody(body);
          body = r.body;
          imageCount = r.imageCount;
          fromCache = r.fromCache;
        }
      } catch (e) {
        log(`请求体解析失败（按原样转发）：${e.message}`);
      }
    }

    // 转发上游
    const upUrl = cfg.upstream.replace(/\/+$/, "") + path;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (["host", "content-length", "connection", "transfer-encoding"].includes(k)) continue;
      headers[k] = v;
    }
    headers["content-type"] = "application/json";

    let up;
    try {
      up = await fetch(upUrl, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body !== null ? JSON.stringify(body) : raw,
      });
    } catch (e) {
      log(`上游连接失败 ${upUrl}：${e.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      }
      res.end(
        JSON.stringify({
          error: { message: `vision-bridge 无法连接上游 ${cfg.upstream}（${e.message}）` },
        }),
      );
      return;
    }

    // 透传响应（含 SSE 流式）
    const upHeaders = {};
    for (const [k, v] of up.headers) {
      if (["transfer-encoding", "connection", "content-length"].includes(k.toLowerCase())) continue;
      upHeaders[k] = v;
    }
    res.writeHead(up.status, upHeaders);
    if (up.body) {
      await new Promise((resolve, reject) => {
        const rs = Readable.fromWeb(up.body);
        rs.on("error", reject);
        res.on("error", reject);
        rs.pipe(res);
        res.on("finish", resolve);
      });
    } else {
      res.end();
    }

    const ms = Date.now() - start;
    if (/responses|chat\/completions/.test(path)) {
      log(`${req.method} ${path} -> ${up.status} | 图片=${imageCount} 缓存=${fromCache} | ${ms}ms`);
    }
  } catch (e) {
    log(`处理异常：${e.stack || e.message}`);
    try {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: { message: "vision-bridge 内部错误：" + e.message } }));
    } catch {}
  }
});

server.listen(cfg.port, cfg.listen, () => {
  log(`vision-bridge 已启动：http://${cfg.listen}:${cfg.port} -> 上游 ${cfg.upstream}`);
});

function shutdown() {
  log("vision-bridge 退出");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
