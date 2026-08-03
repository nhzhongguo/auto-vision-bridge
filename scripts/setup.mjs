#!/usr/bin/env node
/**
 * auto-vision-bridge 交互式配置向导
 * ---------------------------------------------------------------
 * 用途：帮用户把视觉模型 API Key 写进 bridge/config.json，
 *       不需要手动编辑 JSON，也不会有 Key 泄漏到 git。
 * 用法：
 *   node scripts/setup.mjs          # 交互式向导（推荐）
 *   node scripts/setup.mjs --test   # 配置完成后自动用 1x1 测试图验证 Key
 *
 * 配置完成后：
 *   Windows:  powershell -ExecutionPolicy Bypass -File bridge/start-bridge.ps1
 *   其他系统: node bridge/server.mjs
 *   然后把 AI 客户端的 base_url 改成 http://127.0.0.1:57399/v1 并重启。
 */
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = join(ROOT, "..", "bridge");
const CONFIG_PATH = join(BRIDGE_DIR, "config.json");
const EXAMPLE_PATH = join(BRIDGE_DIR, "config.example.json");

const PROVIDERS = [
  {
    id: "zhipu",
    name: "智谱 BigModel（推荐）",
    model: "glm-4.6v",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    keyUrl: "https://open.bigmodel.cn → 控制台 → API Keys",
    note: "注册送 600 万 tokens，glm-4.6v 实测可用",
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    model: "Qwen/Qwen2.5-VL-7B-Instruct",
    baseUrl: "https://api.siliconflow.cn/v1/chat/completions",
    keyUrl: "https://cloud.siliconflow.cn → API 密钥",
    note: "注册送 2000 万 tokens，Qwen2.5-VL 7B/32B/72B 等免费",
  },
  {
    id: "custom",
    name: "自定义 OpenAI 兼容端点",
    model: "",
    baseUrl: "",
    keyUrl: "由你自己的视觉服务商提供",
    note: "任意支持 OpenAI 兼容 /chat/completions 的视觉服务",
  },
];

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question, fallback = "") {
  return new Promise((resolve) => {
    rl.question(question, (ans) => resolve(ans.trim() || fallback));
  });
}

/** 静默输入 API Key（不回显） */
function askSecret(question) {
  return new Promise((resolve) => {
    const orig = process.stdout.write.bind(process.stdout);
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) orig(s);
    };
    rl.question(question, (ans) => {
      rl._writeToOutput = (s) => orig(s);
      process.stdout.write("\n");
      resolve(ans.trim());
    });
    muted = true;
  });
}

/** 用 1x1 测试图验证视觉 API Key 是否可用 */
async function testVision(config) {
  console.log("\n🔍 正在验证 API Key（发送 1x1 测试图，几乎不消耗 tokens）...");
  try {
    const payload = {
      model: config.visionModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG_B64}` } },
            { type: "text", text: "用一句话描述这张图片" },
          ],
        },
      ],
    };
    const resp = await fetch(config.visionBaseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.zhipuApiKey}` },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("返回内容为空");
    console.log(`✅ Key 有效！视觉模型回答：${String(text).slice(0, 120)}`);
    return true;
  } catch (e) {
    console.log(`❌ Key 验证失败：${e.message}`);
    console.log("请检查 Key 是否正确、额度是否充足、服务商是否可用。");
    return false;
  }
}

async function main() {
  console.log("==============================================");
  console.log("  Auto Vision Bridge — 配置向导");
  console.log("  给你的纯文本大模型自动补上「看图」能力");
  console.log("==============================================\n");

  // 1. 选择视觉服务
  console.log("请选择视觉模型服务商：");
  PROVIDERS.forEach((p, i) => {
    console.log(`  ${i + 1}) ${p.name} — ${p.note}`);
  });
  const choice = await ask(`输入序号（1-${PROVIDERS.length}，默认 1）：`, "1");
  const idx = Math.min(Math.max(parseInt(choice, 10) || 1, 1), PROVIDERS.length) - 1;
  const provider = PROVIDERS[idx];

  console.log(`\n📌 ${provider.name}`);
  console.log(`   获取 Key：${provider.keyUrl}`);
  if (provider.id === "custom") {
    provider.baseUrl = await ask("   输入你的 OpenAI 兼容端点 URL：");
    provider.model = await ask("   输入视觉模型名：");
  }
  const apiKey = await askSecret("🔑 粘贴你的 API Key（输入时不会显示，粘贴后回车）：");
  if (!apiKey || apiKey === "在这里填你的视觉模型 API Key") {
    console.log("\n❌ 未输入有效的 API Key，已取消。");
    process.exit(1);
  }

  // 2. 上游地址（用户的模型中转/代理地址）
  const upstream = await ask(
    "\n🌐 你的大模型中转地址（不带 /v1，回车用默认）\n   [http://127.0.0.1:57321]：",
    "http://127.0.0.1:57321",
  );

  // 3. 端口
  const port = await ask("🔌 监听端口（回车用默认）\n   [57399]：", "57399");

  // 4. 组装配置
  const example = existsSync(EXAMPLE_PATH) ? JSON.parse(readFileSync(EXAMPLE_PATH, "utf8")) : {};
  const config = {
    ...example,
    listen: "127.0.0.1",
    port: parseInt(port, 10) || 57399,
    upstream: upstream.replace(/\/+$/, ""),
    zhipuApiKey: apiKey,
    visionBaseUrl: provider.baseUrl,
    visionModel: provider.model,
  };

  // 5. 备份旧配置并写入
  if (existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH + ".bak", readFileSync(CONFIG_PATH, "utf8"));
    console.log("\n💾 已备份旧配置到 bridge/config.json.bak");
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  console.log("✅ 配置已写入 bridge/config.json");

  // 6. 可选验证
  let doTest = process.argv.includes("--test");
  if (!doTest) {
    const yn = await ask("🧪 是否立即验证 Key 是否可用？(y/n，默认 y)：", "y");
    doTest = yn.toLowerCase() === "y" || yn.toLowerCase() === "yes";
  }
  if (doTest) await testVision(config);

  // 7. 交付说明
  console.log("\n==============================================");
  console.log("🎉 配置完成！接下来：");
  console.log("==============================================");
  console.log("1️⃣  启动 Bridge（二选一）");
  console.log("    Windows:  powershell -ExecutionPolicy Bypass -File bridge/start-bridge.ps1");
  console.log("    其他系统: node bridge/server.mjs");
  console.log("    验证:     curl http://127.0.0.1:57399/health");
  console.log(`2️⃣  把 AI 客户端的 base_url 改为：`);
  console.log(`    http://127.0.0.1:${parseInt(port, 10) || 57399}/v1`);
  console.log("3️⃣  重启 AI 客户端");
  console.log("4️⃣  直接发图测试 —— 不支持视觉的模型会自动转文字，支持的直接透传\n");
  rl.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("配置失败：", e.message);
  process.exit(1);
});
