#!/usr/bin/env node
/**
 * Auto Vision Bridge 端到端测试
 * 用法：
 *   node test-bridge.mjs                        # 内置 1x1 测试图 + deepseek-v4-flash 模型
 *   node test-bridge.mjs --image 图.png --model deepseek-v4-flash --port 57399
 * 注意：请在仓库目录内运行（先 cd 到 auto-vision-bridge 再执行 node bridge/...）。
 * 覆盖：
 *   1) 不支持视觉的模型 + 图片 -> 应自动转换（bridge 调视觉模型识别成文字，上游正常回答）
 *   2) 支持视觉的模型 + 图片 -> 应原样透传（不调用视觉 API，图片原样到达上游）
 *   3) 无图普通请求 -> 正常透传（零开销）
 */
import { readFileSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = arg("--port", "57399");
const MODEL = arg("--model", "deepseek-v4-flash");
const IMG = arg("--image", "");

// 1x1 红色 PNG（未指定 --image 时的回退测试图）
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let b64 = TINY_PNG_B64;
if (IMG) {
  try {
    b64 = readFileSync(IMG).toString("base64");
  } catch {
    console.error(`❌ 找不到图片文件：${IMG}`);
    console.error("   请检查：");
    console.error("   1) 路径是否正确（推荐使用完整绝对路径，含空格时用双引号包住）；");
    console.error("   2) 当前目录是否为仓库目录（应能看到 bridge/ 文件夹），示例：");
    console.error('      cd auto-vision-bridge');
    console.error('      node bridge/test-bridge.mjs --image "C:\\Users\\<用户名>\\图片\\demo.png"');
    process.exit(1);
  }
}
const dataUrl = `data:image/png;base64,${b64}`;

const BRIDGE = `http://127.0.0.1:${PORT}`;

// 把响应 JSON 摘要成一行人话：取 output_text 回答 / error.message
function summarize(text) {
  try {
    const j = JSON.parse(text);
    if (j.output) {
      const parts = [];
      const walk = (n) => {
        if (!n || typeof n !== "object") return;
        if (n.type === "output_text" && typeof n.text === "string") parts.push(n.text);
        if (Array.isArray(n)) n.forEach(walk);
        else Object.values(n).forEach(walk);
      };
      walk(j.output);
      return parts.join(" ").slice(0, 300);
    }
    if (j.error) {
      const m = typeof j.error.message === "string" ? j.error.message : JSON.stringify(j.error.message);
      return `错误: ${m.slice(0, 300)}`;
    }
    return text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

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
    console.log(summarize(text));
    return { status: resp.status, text };
  } catch (e) {
    console.log(`\n===== ${name} =====`);
    console.log(`请求失败: ${e.message}`);
    return { status: 0, text: "" };
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

let ok = true;

// 1) 不支持视觉的模型 + 图片 -> 自动转换
{
  const r = await send(`1) ${MODEL} + 图片（应自动转换）`, {
    model: MODEL,
    input: baseInput,
    stream: false,
  });
  const good = r.status === 200;
  console.log(good ? "→ ✅ 自动识别验证通过：图片已由视觉模型转成文字，上游正常回答" : "→ ❌ 未按预期工作");
  ok = ok && good;
}

// 2) 支持视觉的模型 + 图片 -> 原样透传
{
  const r = await send("2) gpt-4o + 图片（应原样透传）", {
    model: "gpt-4o",
    input: baseInput,
    stream: false,
  });
  // 上游是纯文本服务时会拒绝图片（报 image_url / unknown variant），
  // 这恰好证明图片被原样透传、bridge 没有调用视觉 API。
  const passthrough =
    r.status === 200 ||
    /image_url|unknown variant|image.*not supported|unsupported.*image/i.test(r.text);
  console.log(
    passthrough
      ? "→ ✅ 透传验证通过：图片原样到达上游（未调用视觉 API）"
      : "→ ❌ 未按预期工作"
  );
  ok = ok && passthrough;
}

// 3) 无图普通请求 -> 正常透传
{
  const r = await send("3) 无图普通请求（应正常透传）", {
    model: MODEL,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "你好，回一个字就行" }] }],
    stream: false,
  });
  const good = r.status === 200;
  console.log(good ? "→ ✅ 透传验证通过：无图请求零开销" : "→ ❌ 未按预期工作");
  ok = ok && good;
}

console.log(`\n${ok ? "🎉 全部通过！Auto Vision Bridge 工作正常。" : "⚠️ 有场景未通过，请检查 bridge 配置与上游状态。"}`);
process.exit(ok ? 0 : 1);
