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
import { watch, writeFileSync } from "node:fs";
import os from "node:os";

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
  // 模型别名：客户端模型名 -> 上游真实模型名。用于绕过客户端"此模型不支持图片"的前置拦截，
  // 例：{"gpt-4o": "deepseek-v4-flash"} -> 客户端配 gpt-4o 可发图，bridge 转回真实模型并强制识图
  modelAliases: {},
  // 调用视觉模型时是否在窗口输出提示（仅流式请求生效）
  noticeEnabled: true,
  noticeText: "📷 检测到当前模型不支持直接看图，正在调用视觉模型识别图片…\n",
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

/* ---------------- 自动修复 Codex 模型目录（动态放行图片输入） ----------------
 * 背景：Codex 客户端会根据 model_catalog_json 里每个模型的 input_modalities 判断
 * 能否发图。很多中转/自定义模型被标成 "text"，导致客户端直接拦截："此模型不支持图片输入"。
 * 这里不写死任何模型名，自动读取正在使用的 catalog，把所有不带 image 的条目补上 image；
 * 是否真的转文字由 modelSupportsVision() 按白名单/黑名单动态判断，视觉模型原样透传。
 * 同时监听 catalog 文件：cc-switch 等工具切换模型重写该文件后，自动再次修复。
 */
function codexCatalogPath() {
  const home = process.env.CODEX_HOME || join(os.homedir(), ".codex");
  const tomlPath = join(home, "config.toml");
  let rel = "cc-switch-model-catalog.json";
  try {
    const toml = readFileSync(tomlPath, "utf8");
    const m = toml.match(/^model_catalog_json\s*=\s*"([^"]+)"/m);
    if (m) rel = m[1];
  } catch {}
  return join(home, rel);
}

let lastCatalogSig = ""; // 已修复内容的签名，避免重复写盘
function fixModelCatalog(silent) {
  const catPath = codexCatalogPath();
  let cat;
  try {
    cat = JSON.parse(readFileSync(catPath, "utf8"));
  } catch (e) {
    if (!silent) log(`[catalog修复] 跳过：${catPath} 不存在或无法解析（${e.message}）`);
    return;
  }
  const sig = JSON.stringify(cat.models || []);
  if (sig === lastCatalogSig) return; // 内容没变化
  const fixed = [];
  let changed = false;
  for (const m of cat.models || []) {
    let mods = m.input_modalities;
    if (typeof mods === "string") mods = [mods];
    if (!Array.isArray(mods)) continue;
    if (!mods.includes("image")) {
      mods = [...mods, "image"];
      m.input_modalities = mods;
      fixed.push(m.slug || m.model || "?");
      changed = true;
    }
  }
  if (changed) {
    try {
      writeFileSync(catPath, JSON.stringify(cat, null, 2) + "\n", "utf8");
      lastCatalogSig = JSON.stringify(cat.models || []);
      log(`[catalog修复] 已自动放行图片输入：${fixed.join(", ")}（重启 Codex 后生效）`);
    } catch (e) {
      log(`[catalog修复] 写入失败：${e.message}`);
    }
  } else {
    lastCatalogSig = sig;
  }
}

let fixTimer = null;
function scheduleCatalogFix() {
  clearTimeout(fixTimer);
  fixTimer = setTimeout(() => fixModelCatalog(false), 500); // 等 cc-switch 写完文件
}

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
/* 图片 URL 规范化：处理客户端常见的坏格式
 *  - base64 被 URL 编码（%3D/%2B/%0A...）或被插入换行/空白
 *  - http(s) 图片链接：很多客户端发的是带鉴权的临时链接，智谱服务端抓不到。
 *    这里由 bridge 自己取回图片转成 data URL 再发给智谱，保证能用。
 *    取回时带上原请求的 authorization 头（若是同一来源的临时链接）。
 */
async function normalizeImageUrl(url, authHeaders) {
  if (typeof url !== "string") return url;
  let u = url.trim();
  const idx = u.indexOf(";base64,");
  if (idx >= 0) {
    let payload = u.slice(idx + 8);
    if (/%[0-9a-fA-F]{2}/.test(payload)) {
      try { payload = decodeURIComponent(payload); } catch {}
    }
    payload = payload.replace(/\s+/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
    return u.slice(0, idx + 8) + payload;
  }
  if (/%[0-9a-fA-F]{2}/.test(u)) {
    try { u = decodeURIComponent(u); } catch {}
  }
  if (/^https?:\/\//i.test(u)) {
    try {
      const headers = {};
      const auth = (authHeaders && (authHeaders.authorization || authHeaders.Authorization)) || "";
      if (auth) headers.authorization = auth;
      const r = await fetch(u, { headers, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) throw new Error("空响应");
      const ct = (r.headers.get("content-type") || "image/png").split(";")[0].trim().toLowerCase();
      if (!ct.startsWith("image/") && !ct.includes("octet-stream")) {
        log(`[图片] 注意：${u} 的 content-type 是 ${ct}，仍按图片尝试`);
      }
      log(`[图片] 已从链接取回图片：${u.slice(0, 90)}…（${buf.length} 字节, ${ct}）`);
      return `data:${ct.startsWith("image/") ? ct : "image/png"};base64,${buf.toString("base64")}`;
    } catch (e) {
      log(`[图片] 链接取回失败 ${u.slice(0, 90)}…：${e.message}，改由智谱直接抓取`);
    }
  }
  return u;
}

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
  if (!cfg.zhipuApiKey || /在这里填|your[_-]?api[_-]?key|example/i.test(cfg.zhipuApiKey)) {
    throw new Error(
      "未配置有效的视觉模型 API Key（bridge/config.json 的 zhipuApiKey）。" +
      "请运行 node scripts/setup.mjs 交互式配置，或手动把 Key 填进 bridge/config.json 后重启 bridge。"
    );
  }
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
function labelFor(urls, url, descs, normMap) {
  const norm = (normMap && normMap.get(url)) || url;
  const idx = urls.indexOf(norm) + 1;
  let d = (descs.get(norm) || "").trim().replace(/\s+/g, " ");
  if (d.length > cfg.maxDescChars) d = d.slice(0, cfg.maxDescChars) + "…";
  return `[图片${idx}: ${d}]`;
}

async function processBody(body, authHeaders) {
  const state = { found: [] };
  walk(body, null, null, state);
  if (!state.found.length) return { body, imageCount: 0, replaced: 0, fromCache: 0, converted: 0 };

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

  // 规范化（URL 解码/去空白/本地图取回），并记录 原始URL -> 规范化URL 映射
  const normMap = new Map();
  for (let i = 0; i < urls.length; i++) {
    const before = urls[i];
    urls[i] = await normalizeImageUrl(urls[i], authHeaders);
    if (!normMap.has(before)) normMap.set(before, urls[i]);
  }
  const uniq = [];
  const seen2 = new Set();
  for (const u of urls) {
    if (!seen2.has(u)) { seen2.add(u); uniq.push(u); }
  }
  urls.length = 0;
  urls.push(...uniq);

  // 逐张识别（缓存命中则不调 API）
  const descs = new Map();
  let fromCache = 0;
  let converted = 0;
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    const hit = cacheGet(u);
    if (hit !== null) {
      descs.set(u, hit);
      fromCache++;
      log(`[图片 ${i + 1}/${urls.length}] 命中缓存`);
      continue;
    }
    converted++;
    try {
      const t = await describeImage(u);
      descs.set(u, t);
      cachePut(u, t);
      log(`[图片 ${i + 1}/${urls.length}] 识别成功（${t.length} 字）`);
    } catch (e) {
      descs.set(u, `[图片识别失败：${e.message}]`);
      const mime = (u.match(/^data:([^;,]+)/) || [])[1] || u.slice(0, 40);
      const b64 = u.includes(";base64,") ? u.split(";base64,")[1] : "";
      log(`[图片 ${i + 1}/${urls.length}] 识别失败：${e.message} | mime=${mime} b64长度=${b64.length} 前缀=${b64.slice(0, 40)}`);
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
        ? { type: "input_text", text: labelFor(urls, f.url, descs, normMap) }
        : { type: "text", text: labelFor(urls, f.url, descs, normMap) };
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
  return { body, imageCount: urls.length, replaced, fromCache, converted };
}


/* ---------------- 流式响应透传（可注入视觉调用提示） ---------------- */
function pipePlain(res, body) {
  return new Promise((resolve, reject) => {
    const rs = Readable.fromWeb(body);
    rs.on("error", reject);
    res.on("error", reject);
    rs.pipe(res);
    res.on("finish", resolve);
  });
}

// 提示拼接式注入：不新建消息，只把提示拼进上游第一条回答的 output_text.delta 前缀。
// 这样历史里只有一条回答消息，不会出现"提示消息被反复重放"的问题。
// 注意：ResizeObserver/输入框只关心 deltas；done 事件的 text 也要同步前缀，避免客户端状态不一致。
async function pipeWithNotice(res, body, notice, isRespApi) {
  await new Promise((resolve, reject) => {
    const rs = Readable.fromWeb(body);
    let buf = "";
    let targetItemId = null; // 已注入提示的 Responses 消息 item_id
    let done = false;
    const splitEvent = (ev) => {
      const lines = ev.split("\n");
      const evt = (lines.find((l) => l.startsWith("event: ")) || "").slice(7).trim();
      const dl = lines.find((l) => l.startsWith("data: "));
      let data = dl ? dl.slice(6).trim() : "";
      return { evt, data, raw: ev };
    };
    const write = (ev) => res.write(ev);
    const handle = (ev) => {
      const { evt, data, raw } = splitEvent(ev);
      if (!data || data === "[DONE]") return write(raw);
      let j;
      try { j = JSON.parse(data); } catch { return write(raw); }
      if (isRespApi) {
        // 找到第一条 output_text.delta，拼上提示
        if (!targetItemId && evt === "response.output_text.delta" && typeof j.delta === "string") {
          targetItemId = j.item_id;
          j.delta = notice + j.delta;
          log("已将视觉调用提示拼入回答首段（item_id=" + targetItemId + "）");
        } else if (targetItemId && j.item_id === targetItemId) {
          // 同步 done 事件的完整文本，保持客户端累积状态一致
          if (evt === "response.output_text.done" && typeof j.text === "string") {
            if (!j.text.startsWith(notice)) j.text = notice + j.text;
          } else if (evt === "response.content_part.done" && j.part && typeof j.part.text === "string") {
            if (!j.part.text.startsWith(notice)) j.part.text = notice + j.part.text;
          } else if (evt === "response.output_item.done" && Array.isArray(j.item?.content)) {
            for (const p of j.item.content) {
              if (p && p.type === "output_text" && typeof p.text === "string" && !p.text.startsWith(notice)) {
                p.text = notice + p.text;
              }
            }
          }
        }
      } else {
        // Chat Completions：在第一个 content delta 前拼提示
        const ch = j.choices?.[0]?.delta;
        if (!done && ch && typeof ch.content === "string") {
          done = true;
          ch.content = notice + ch.content;
          log("已将视觉调用提示拼入 chat 回答首段");
        }
      }
      const nl = raw.endsWith("\n\n") ? "\n\n" : "";
      const out = raw.slice(0, raw.length - nl.length);
      const dataIdx = out.indexOf("data: ");
      write(out.slice(0, dataIdx) + "data: " + JSON.stringify(j) + nl);
    };
    rs.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      while (true) {
        const idx = buf.indexOf("\n\n");
        if (idx < 0) break;
        const ev = buf.slice(0, idx + 2);
        buf = buf.slice(idx + 2);
        handle(ev);
      }
    });
    rs.on("end", () => {
      if (buf) handle(buf.endsWith("\n\n") ? buf : buf + "\n\n");
      res.end();
      resolve();
    });
    rs.on("error", reject);
    res.on("error", reject);
  });
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
    let converted = 0;
    if (raw) {
      try {
        body = JSON.parse(raw);
        let model = body?.model ?? "";
        // 模型别名：客户端名 -> 上游真实名，并强制走识图转换（绕过客户端图片拦截）
        let forceConvert = false;
        if (cfg.modelAliases && typeof cfg.modelAliases === "object" && cfg.modelAliases[model]) {
          const real = cfg.modelAliases[model];
          log(`模型别名 "${model}" -> "${real}"（强制识图转换）`);
          body.model = real;
          model = real;
          forceConvert = true;
        }
        if (!forceConvert && modelSupportsVision(model)) {
          log(`模型 "${model}" 支持多模态，图片原样透传（不转换）`);
        } else {
          if (model) log(`模型 "${model}" 不支持视觉，自动转换图片`);
          const r = await processBody(body, req.headers);
          body = r.body;
          imageCount = r.imageCount;
          fromCache = r.fromCache;
          converted = r.converted;
        }
      } catch (e) {
        log(`请求体解析失败（按原样转发）：${e.message}`);
      }
    }

    const isStream = !!(body && body.stream === true);

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
      const notice =
        cfg.noticeEnabled && isStream && converted > 0 && /responses|chat\/completions/.test(path)
          ? cfg.noticeText
          : null;
      if (notice) {
        await pipeWithNotice(res, up.body, notice, path.startsWith("/v1/responses"));
      } else {
        await pipePlain(res, up.body);
      }
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

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    const msg = `端口 ${cfg.port} 已被占用：可能 bridge 已在运行（先停止旧进程，或改 config.json 的 port）。错误：${e.message}`;
    console.error(msg);
    log(msg);
    process.exit(1);
  }
  console.error(`[vision-bridge] 服务错误：${e.message}`);
  log(`服务错误：${e.message}`);
});
server.listen(cfg.port, cfg.listen, () => {
  log(`vision-bridge 已启动：http://${cfg.listen}:${cfg.port} -> 上游 ${cfg.upstream}`);
});

// 启动即修复一次模型目录，并监听后续被 cc-switch 等工具覆盖的情况
fixModelCatalog(false);
try {
  watch(codexCatalogPath(), { persistent: false }, (evt) => {
    if (evt === "change") scheduleCatalogFix();
  });
  log(`[catalog修复] 已监听 ${codexCatalogPath()}，模型切换后自动重新修复`);
} catch (e) {
  log(`[catalog修复] 监听失败（不影响主服务）：${e.message}`);
}

function shutdown() {
  log("vision-bridge 退出");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
