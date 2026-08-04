#!/usr/bin/env node
/**
 * setup.mjs - 配置 Auto Vision Bridge 技能
 *
 * 重点：
 * - 内置每个服务商的视觉模型目录，只让用户选择已知视觉模型；
 * - 显示免费档/计费风险，付费或价格未知模型默认不做联网测试；
 * - 测试只发送给用户选中的视觉模型，不拿纯文本模型试错。
 */
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { PROVIDERS, billingLabel, getDefaultModel } from "./provider-catalog.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(HERE, "config.json");
const EXAMPLE_PATH = join(HERE, "config.example.json");

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DEFAULT_PROMPT =
  "请完整描述这张图片：可见文字（OCR）、主体、场景、布局、颜色。用中文回答。";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question, fallback = "") {
  return new Promise((resolve) => {
    rl.question(question, (ans) => resolve(ans.trim() || fallback));
  });
}

function askSecret(question) {
  return new Promise((resolve) => {
    const orig = process.stdout.write.bind(process.stdout);
    rl._writeToOutput = (s) => {
      if (!askSecret.muted) orig(s);
    };
    askSecret.muted = true;
    rl.question(question, (ans) => {
      askSecret.muted = false;
      rl._writeToOutput = (s) => orig(s);
      process.stdout.write("\n");
      resolve(ans.trim());
    });
  });
}
askSecret.muted = false;

function providerEndpoint(provider, model, accountId = "") {
  return provider.endpoint
    .replace("{model}", encodeURIComponent(model))
    .replace("{account}", encodeURIComponent(accountId));
}

function detectLocalUpstream() {
  try {
    const codexHome = process.env.CODEX_HOME || join(os.homedir(), ".codex");
    const toml = readFileSync(join(codexHome, "config.toml"), "utf8");
    const m = toml.match(/^\s*base_url\s*=\s*["']([^"']+)["']/m);
    if (!m) return "";
    const url = m[1].replace(/\/+$/, "");
    if (/^https?:\/\/127\.0\.0\.1:\d+\/v1$/i.test(url)) return url.slice(0, -3);
    if (/^https?:\/\/localhost:\d+\/v1$/i.test(url)) return url.slice(0, -3);
  } catch {}
  return "";
}

function printBilling(model) {
  const level = model?.billing ?? "unknown";
  const icon = level === "free" ? "✅" : level === "paid" ? "💳" : "⚠️";
  console.log(`    ${icon} ${billingLabel(model)}`);
}

function chooseProvider() {
  return (async () => {
    console.log("请选择视觉模型服务商：");
    PROVIDERS.forEach((p, i) => {
      const freeCount = p.models.filter((m) => m.billing === "free").length;
      console.log(`  ${i + 1}) ${p.name} — ${p.models.length} 个内置视觉模型，${freeCount} 个免费档`);
    });
    console.log(`  ${PROVIDERS.length + 1}) 自定义 OpenAI 兼容端点 — 价格未知，默认按可能收费处理`);
    const choice = await ask(`输入序号（1-${PROVIDERS.length + 1}，默认 1）：`, "1");
    const n = Math.min(Math.max(parseInt(choice, 10) || 1, 1), PROVIDERS.length + 1);
    if (n === PROVIDERS.length + 1) {
      return {
        id: "custom",
        name: "自定义 OpenAI 兼容端点",
        keyUrl: "由你的视觉服务商提供",
        keyHint: "请确认端点支持 image_url 图片输入",
        endpoint: "",
        style: "openai",
        models: [],
        custom: true,
      };
    }
    return PROVIDERS[n - 1];
  })();
}

async function chooseModel(provider) {
  if (provider.custom) {
    const endpoint = await ask("输入 OpenAI 兼容端点 URL：");
    const model = await ask("输入视觉模型名（只填支持图片的模型）：");
    const looksVision = /(vl|vision|omni|multimodal|4v|4o|claude|gemini|llava|internvl|minicpm|flash)/i.test(model);
    if (!looksVision) {
      console.log("\n⚠️ 这个模型名不像视觉模型。为避免把纯文本模型拿来测试，本次将保存配置但跳过自动验证。");
    }
    return {
      model: { id: model, vision: looksVision ? true : undefined, billing: "unknown", note: "自定义模型，价格未知" },
      endpoint,
    };
  }

  const models = provider.models.filter((m) => m.vision);
  console.log(`\n${provider.name}：只显示已登记的视觉模型（不会测试纯文本模型）`);
  models.forEach((m, i) => {
    const marker = m === getDefaultModel(provider) ? "（推荐）" : "";
    console.log(`  ${i + 1}) ${m.id} ${marker} — ${m.note}`);
    printBilling(m);
  });
  const defaultIndex = Math.max(0, models.indexOf(getDefaultModel(provider)));
  const choice = await ask(`选择模型（1-${models.length}，默认 ${defaultIndex + 1}）：`, String(defaultIndex + 1));
  const index = Math.min(Math.max(parseInt(choice, 10) || defaultIndex + 1, 1), models.length) - 1;
  return { model: models[index], endpoint: provider.endpoint };
}

async function testVision(config, provider, model) {
  if (!model?.vision) {
    console.log("\n⏭️ 当前模型未确认支持视觉，已跳过联网测试（不会拿纯文本模型试错）。");
    return false;
  }
  if (provider.style === "cloudflare") {
    console.log("\n⏭️ Cloudflare Workers AI 使用专用请求格式，本向导暂不自动发送测试请求；配置已保存，请按服务商文档确认额度与视觉输入格式。");
    return false;
  }

  console.log(`\n正在验证视觉模型 ${model.id}（仅发送 1×1 测试图）...`);
  try {
    let url = config.baseUrl;
    let body;
    let headers = { "content-type": "application/json" };
    if (provider.style === "gemini") {
      url = providerEndpoint(provider, model.id);
      url += `${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(config.apiKey)}`;
      body = {
        contents: [{
          role: "user",
          parts: [
            { text: "用一句话描述这张图片" },
            { inline_data: { mime_type: "image/png", data: TINY_PNG_B64 } },
          ],
        }],
      };
    } else {
      body = {
        model: model.id,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG_B64}` } },
            { type: "text", text: "用一句话描述这张图片" },
          ],
        }],
      };
      headers.authorization = `Bearer ${config.apiKey}`;
    }

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = data?.error?.message ?? data?.message ?? JSON.stringify(data ?? {}).slice(0, 240);
      throw new Error(`HTTP ${resp.status}: ${msg}`);
    }
    const text = provider.style === "gemini"
      ? (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim()
      : data?.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error("返回内容为空");
    console.log(`✅ 视觉模型验证成功：${String(text).slice(0, 120)}`);
    return true;
  } catch (e) {
    const msg = String(e?.message ?? e);
    console.log(`\n❌ 视觉模型验证失败：${msg}`);
    if (/401|403/.test(msg)) console.log("  - Key 无效或权限不足。");
    else if (/402/.test(msg)) console.log("  - 账号余额/额度不足；当前模型可能不是免费档。");
    else if (/429/.test(msg)) console.log("  - 触发限流，稍后重试或换免费视觉模型。");
    else if (/400/.test(msg)) console.log("  - 模型名或图片格式不正确，请确认选择的是视觉模型。");
    else if (/5\d\d/.test(msg)) console.log("  - 服务商临时故障，稍后重试。");
    return false;
  }
}

async function main() {
  console.log("==============================================");
  console.log("  Auto Vision Bridge - 配置向导");
  console.log("  只选择视觉模型，并在测试前提示计费风险");
  console.log("==============================================\n");

  const provider = await chooseProvider();
  const selected = await chooseModel(provider);
  const model = selected.model;

  console.log(`\n${provider.name}`);
  console.log(`获取 Key：${provider.keyUrl}`);
  console.log(`提示：${provider.keyHint}`);
  console.log(`已选择模型：${model.id}`);
  printBilling(model);

  if (model.billing !== "free") {
    console.log("\n⚠️ 计费提醒：当前模型不是明确的免费档。联网测试会发送图片请求，可能按照服务商规则扣费。");
    console.log("   如果不确定价格，请选择跳过测试；配置仍会保存。");
  }

  let accountId = "";
  if (provider.id === "cloudflare") {
    accountId = await ask("输入 Cloudflare Account ID：");
  }
  const apiKey = await askSecret("粘贴你的 API Key（不会回显，粘贴后回车）：");
  if (!apiKey || /在这里填|your[_-]?api[_-]?key|example/i.test(apiKey)) {
    console.log("\n未输入有效的 API Key，已取消。");
    rl.close();
    process.exitCode = 1;
    return;
  }

  const useBridge = (await ask("\n是否同时启用透明中转模式（常驻 bridge，y/n，默认 n）：", "n")).toLowerCase();
  const detectedUpstream = detectLocalUpstream();
  const bridge = {
    enabled: useBridge === "y" || useBridge === "yes",
    listen: "127.0.0.1",
    port: 57399,
    upstream: detectedUpstream || "http://127.0.0.1:57321",
  };
  if (bridge.enabled) {
    bridge.upstream = await ask(`大模型中转地址（不带 /v1，默认 ${bridge.upstream}）：`, bridge.upstream);
    bridge.port = parseInt(await ask("监听端口（默认 57399）：", "57399"), 10) || 57399;
  }

  const example = existsSync(EXAMPLE_PATH) ? JSON.parse(readFileSync(EXAMPLE_PATH, "utf8")) : {};
  const config = {
    ...example,
    provider: provider.id,
    apiKey,
    baseUrl: selected.endpoint || providerEndpoint(provider, model.id, accountId),
    model: model.id,
    modelBilling: model.billing,
    modelBillingNote: model.note,
    accountId: accountId || undefined,
    prompt: DEFAULT_PROMPT,
    bridge,
  };
  if (!config.accountId) delete config.accountId;

  if (existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH + ".bak", readFileSync(CONFIG_PATH, "utf8"));
    console.log("\n已备份旧配置到 config.json.bak");
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  console.log("配置已写入 scripts/config.json");

  let doTest = process.argv.includes("--test");
  if (!doTest) {
    const defaultTest = model.billing === "free" ? "y" : "n";
    const yn = (await ask(`\n是否立即验证已选择的视觉模型？(y/n，默认 ${defaultTest})：`, defaultTest)).toLowerCase();
    doTest = yn === "y" || yn === "yes";
  }
  if (doTest && model.billing !== "free") {
    const confirm = (await ask("确认承担该模型可能产生的费用并继续测试吗？(y/N)：", "n")).toLowerCase();
    if (confirm !== "y" && confirm !== "yes") {
      doTest = false;
      console.log("已跳过联网测试；没有发送视觉请求。");
    }
  }
  if (doTest) await testVision(config, provider, model);

  console.log("\n==============================================");
  console.log("配置完成。直接识图：");
  console.log('  node scripts/analyze_image.mjs --image "图片路径" --prompt "你的问题"');
  if (bridge.enabled) {
    console.log("透明中转：");
    console.log("  node scripts/start-bridge.mjs");
    console.log(`  再把 Codex config.toml 的 base_url 改为 http://127.0.0.1:${bridge.port}/v1 并重启客户端`);
  }
  console.log("==============================================\n");
  rl.close();
  process.exitCode = 0;
}

main().catch((e) => {
  console.error("配置失败：", e.message);
  rl.close();
  process.exitCode = 1;
});
