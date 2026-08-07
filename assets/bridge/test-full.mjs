#!/usr/bin/env node
/**
 * vision-bridge 完整端到端测试（Responses API + Chat Completions + 流式）
 * 用法：
 *   node test-full.mjs                        # 内置随机颜色 1x1 测试图
 *   node test-full.mjs --image 图.png --port 57399
 *
 * 场景：
 *   1) Responses API + deepseek + 图片 + 流式（SSE pipeWithNotice 注入提示验证）
 *   2) Responses API + deepseek + 图片 + 非流式（核心链路：图片转文字替换）
 *   3) Responses API + 视觉白名单模型 + 图片（原样透传：不替换成 [图片N:]）
 *   4) Chat Completions + deepseek + 图片（兼容老客户端）
 *   5) Responses API + 无图普通请求（零开销透传）
 *   6) Responses API + 模型别名 gpt-4o -> deepseek-v4-flash（强制识图转换）
 */
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import os from "node:os";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = arg("--port", "57399");
const IMG = arg("--image", "");
const BRIDGE = `http://127.0.0.1:${PORT}`;

// 随机颜色 1x1 PNG：每次运行都是新图片，避免命中 bridge 的图片描述缓存
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function tinyPng() {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, r, g, b]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

const b64 = IMG ? readFileSync(IMG).toString("base64") : tinyPng().toString("base64");
const dataUrl = `data:image/png;base64,${b64}`;
// 上游可能强制鉴权：优先读 Codex config.toml 的 experimental_bearer_token（占位 Key 会被上游 401 拦截）
function upstreamAuth() {
  try {
    const home = process.env.CODEX_HOME || join(os.homedir(), ".codex");
    const toml = readFileSync(join(home, "config.toml"), "utf8");
    const m = toml.match(/experimental_bearer_token\s*=\s*"([^"]+)"/);
    if (m && m[1]) return `Bearer ${m[1]}`;
  } catch {}
  console.warn("[提示] config.toml 未配置 experimental_bearer_token，使用占位 Key 测试；上游强制鉴权时会 401。");
  return "Bearer test";
}
const AUTH = upstreamAuth();

// ---------- 工具函数 ----------
let passed = 0;
let failed = 0;
function result(name, ok, detail) {
  if (ok) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.log(`❌ ${name}  —  ${detail || ""}`); }
}
async function send(path, body, opts) {
  const stream = opts && opts.stream ? true : false;
  const t0 = Date.now();
  const resp = await fetch(`${BRIDGE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: AUTH },
    body: JSON.stringify({ ...body, stream }),
  });
  if (!stream) {
    const text = await resp.text();
    return { status: resp.status, text, ms: Date.now() - t0, json: safeJson(text) };
  }
  const chunks = [];
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buf.indexOf("\n\n");
      if (idx < 0) break;
      chunks.push(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
  if (buf) chunks.push(buf);
  return { status: resp.status, events: chunks, ms: Date.now() - t0 };
}
function safeJson(t) { try { return JSON.parse(t); } catch { return null; } }
function sseData(ev) {
  const dl = ev.split("\n").find((l) => l.startsWith("data: "));
  return dl ? dl.slice(6).trim() : "";
}
function outputText(json) {
  if (!json) return "";
  if (Array.isArray(json.output)) {
    const parts = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (n.type === "output_text" && typeof n.text === "string") parts.push(n.text);
      if (Array.isArray(n)) n.forEach(walk);
      else Object.values(n).forEach(walk);
    };
    walk(json.output);
    return parts.join(" ").trim();
  }
  const ch = json.choices && json.choices[0];
  if (ch && typeof ch.message?.content === "string") return ch.message.content.trim();
  return "";
}

const baseInput = [
  {
    type: "message", role: "user",
    content: [
      { type: "input_text", text: "这张图里写了什么？" },
      { type: "input_image", image_url: dataUrl },
    ],
  },
];

// ---------- 场景 1（先跑：保持图片未缓存，验证提示注入） ----------
{
  const name = "1) Responses + deepseek + 图片（流式，首 delta 应拼接 📷 视觉提示）";
  try {
    const r = await send("/v1/responses", { model: "deepseek-v4-flash", input: baseInput, stream: true }, { stream: true });
    const firstDelta = r.events
      .map(sseData)
      .filter(Boolean)
      .map((s) => s.trim() === "[DONE]" ? null : safeJson(s))
      .filter((j) => j && j.type === "response.output_text.delta" && typeof j.delta === "string")
      .map((j) => j.delta)[0];
    const ok = r.status === 200 && !!firstDelta && firstDelta.startsWith("📷");
    result(name, ok, ok ? "" : `status=${r.status} firstDelta=${JSON.stringify(firstDelta)}`);
  } catch (e) { result(name, false, e.message); }
}

// ---------- 场景 2 ----------
{
  const name = "2) Responses + deepseek + 图片（非流式，应返回有效回答）";
  try {
    const r = await send("/v1/responses", { model: "deepseek-v4-flash", input: baseInput, stream: false });
    const text = outputText(r.json);
    const ok = r.status === 200 && text.length > 0;
    result(name, ok, ok ? "" : `HTTP ${r.status} | head: ${r.text.slice(0,200)}`);
  } catch (e) { result(name, false, e.message); }
}

// ---------- 场景 3 ----------
{
  const name = "3) Responses + 视觉白名单模型 + 图片（原样透传 / 不替换 [图片N:]）";
  try {
    const r = await send("/v1/responses", { model: "glm-4.6v", input: baseInput, stream: false });
    const notReplaced = !r.text.includes("[图片");
    const upstreamSeen = r.status === 200 || /image|variant|unsupported|not supported/i.test(r.text);
    result(name, notReplaced && upstreamSeen, notReplaced && upstreamSeen ? "" : `HTTP ${r.status} | ${r.text.slice(0,200)}`);
  } catch (e) { result(name, false, e.message); }
}

// ---------- 场景 4 ----------
{
  const name = "4) Chat Completions + deepseek + 图片（兼容模式，应返回有效回答）";
  try {
    const r = await send("/v1/chat/completions", {
      model: "deepseek-v4-flash",
      messages: [
        { role: "user", content: [
          { type: "text", text: "描述这张图" },
          { type: "image_url", image_url: { url: dataUrl } },
        ]},
      ],
      stream: false,
    });
    const ok = r.status === 200 && outputText(r.json).length > 0;
    result(name, ok, ok ? "" : `HTTP ${r.status} | ${r.text.slice(0,200)}`);
  } catch (e) { result(name, false, e.message); }
}

// ---------- 场景 5 ----------
{
  const name = "5) Responses + 无图普通请求（直接透传，HTTP 200）";
  try {
    const r = await send("/v1/responses", {
      model: "deepseek-v4-flash",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "ping，回一个字" }] }],
      stream: false,
    });
    result(name, r.status === 200, `HTTP ${r.status}`);
  } catch (e) { result(name, false, e.message); }
}

// ---------- 场景 6 ----------
{
  const name = "6) 模型别名 gpt-4o -> deepseek-v4-flash（强制识图转换，HTTP 200）";
  try {
    const r = await send("/v1/responses", { model: "gpt-4o", input: baseInput, stream: false });
    result(name, r.status === 200, `HTTP ${r.status}`);
  } catch (e) { result(name, false, e.message); }
}

console.log("");
console.log("");
console.log(`总评: ${passed} 通过 / ${passed + failed} 共`);
process.exit(failed === 0 ? 0 : 1);
