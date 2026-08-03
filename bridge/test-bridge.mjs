#!/usr/bin/env node
/**
 * vision-bridge 端到端测试
 * 用法：
 *   node test-bridge.mjs                        # 内置 1x1 测试图 + deepseek 模型
 *   node test-bridge.mjs --image 图.png --model deepseek-v4-flash-0731 --port 57399
 * 覆盖：
 *   1) 不支持视觉的模型 + 图片 -> 应自动转换（返回里带 [图片1: ...] 描述）
 *   2) 支持视觉的模型 + 图片 -> 应原样透传（不调用视觉 API）
 *   3) 无图普通请求 -> 正常透传
 */
import { readFileSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = arg("--port", "57399");
const MODEL = arg("--model", "deepseek-v4-flash-0731");
const IMG = arg("--image", "");

// 1x1 红色 PNG（未指定 --image 时的回退测试图）
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const b64 = IMG ? readFileSync(IMG).toString("base64") : TINY_PNG_B64;
const dataUrl = `data:image/png;base64,${b64}`;

const BRIDGE = `http://127.0.0.1:${PORT}`;

async function send(name, body) {
  const t0 = Date.now();
  try {
    const resp = await fetch(`${BRIDGE}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    console.log(`\n===== ${name} =====`);
    console.log(`HTTP ${resp.status} | ${Date.now() - t0}ms`);
    console.log(text.slice(0, 600));
    return text;
  } catch (e) {
    console.log(`\n===== ${name} =====`);
    console.log(`请求失败: ${e.message}`);
    return "";
  }
}

const baseInput = [
  {
    type: "message",
    role: "user",
    content: [
      { type: "input_text", text: "这张图里写了什么？" },
      { type: "input_image", image_url: dataUrl },
    ],
  },
];

await send(`1) ${MODEL} + 图片（应自动转换）`, {
  model: MODEL,
  input: baseInput,
  stream: false,
});

await send("2) gpt-4o + 图片（应原样透传）", {
  model: "gpt-4o",
  input: baseInput,
  stream: false,
});

await send("3) 无图普通请求（应正常透传）", {
  model: MODEL,
  input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "你好，回一个字就行" }] }],
  stream: false,
});
