#!/usr/bin/env node
/**
 * doctor.mjs - 体检 Auto Vision Bridge 技能
 *
 * 用法：
 *   node scripts/doctor.mjs           # 检查配置
 *   node scripts/doctor.mjs --test    # 免费档额外实际调用视觉模型验证
 *   node scripts/doctor.mjs --test --force # 用户确认费用后测试付费/未知价格模型
 *   node scripts/doctor.mjs --bridge  # 额外检查本地 bridge 运行状态
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { getProvider } from "./provider-catalog.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(HERE, "config.json");
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const VISION_MARKER =
  /(vl|vision|omni|multimodal|4v|4o|4\.1|4\.5|o1|o3|o4|o5|claude|gemini|llava|internvl|minicpm|step-1v|spark|doubao|hunyuan|glm-4v|glm-4\.6v)/i;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};
const warn = (name, detail = "") => {
  results.push({ name, ok: null });
  console.log(`WARN ${name}${detail ? " - " + detail : ""}`);
};

check("Node.js >= 18", Number(process.versions.node.split(".")[0]) >= 18, `v${process.versions.node}`);

let cfg = {};
if (!existsSync(CONFIG_PATH)) {
  check("config.json 存在", false, `未找到 ${CONFIG_PATH}，运行 node scripts/setup.mjs`);
} else {
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    check("config.json 可解析", true);
  } catch (e) {
    check("config.json 可解析", false, e.message);
  }
}

const key = cfg.apiKey || cfg.visionApiKey || cfg.zhipuApiKey || "";
const baseUrl = cfg.baseUrl || cfg.visionBaseUrl || "";
const model = cfg.model || cfg.visionModel || "";
const providerId = cfg.provider || cfg.visionProvider || "";
const provider = getProvider(providerId);
const modelBilling = cfg.modelBilling || cfg.visionModelBilling || "unknown";
const modelBillingNote = cfg.modelBillingNote || cfg.visionModelBillingNote || "未记录价格信息，按可能收费处理";
const masked = key.length >= 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "(空)";
check("视觉 API Key 已配置", key.length > 8, masked);
check("视觉 API 地址已配置", /^https?:\/\//.test(baseUrl), baseUrl);
check("视觉模型已配置", !!model, model);
check(
  "模型看起来支持视觉",
  !model || VISION_MARKER.test(model) || /(^|[^a-z])v$/i.test(model.trim()),
  `${model}（纯文本模型无法识图，请改成 glm-4.6v 或 Qwen2.5-VL 等视觉模型）`,
);
if (modelBilling === "paid" || modelBilling === "unknown") {
  warn("模型计费风险", `${modelBillingNote}；doctor --test 默认跳过联网请求`);
} else {
  check("模型计费标记", modelBilling === "free", "免费额度/免费档（仍可能限流或耗尽额度）");
}

if (process.argv.includes("--test") && key && baseUrl && model) {
  if (modelBilling !== "free" && !process.argv.includes("--force")) {
    warn("视觉模型实测可用", "已跳过：模型不是明确免费档；如确认承担费用，使用 --force");
  } else {
  if (provider?.style === "cloudflare") {
    warn("视觉模型实测可用", "已跳过：Cloudflare Workers AI 使用专用协议，当前 doctor 不发送测试请求");
  } else {
    try {
      let url = baseUrl;
      let body;
      const headers = { "content-type": "application/json" };
      if (provider?.style === "gemini") {
        url += `${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
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
        headers.authorization = `Bearer ${key}`;
        body = {
          model,
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG_B64}` } },
              { type: "text", text: "用一句话描述这张图片" },
            ],
          }],
        };
      }
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
      const data = await resp.json();
      const text = provider?.style === "gemini"
        ? (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim()
        : data?.choices?.[0]?.message?.content ?? "";
      check("视觉模型实测可用", !!text, String(text).slice(0, 80));
    } catch (e) {
      check("视觉模型实测可用", false, e.message);
    }
  }
  }
}

const wantBridge = process.argv.includes("--bridge") || cfg.bridge?.enabled;
if (wantBridge) {
  const port = cfg.bridge?.port || 57399;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
    const ok = resp.ok && (await resp.json())?.ok === true;
    check("bridge 运行中", ok, `http://127.0.0.1:${port}/health`);
  } catch {
    check("bridge 运行中", false, `端口 ${port} 未响应，运行 node scripts/start-bridge.mjs`);
  }

  const home = process.env.CODEX_HOME || join(os.homedir(), ".codex");
  const tomlPath = join(home, "config.toml");
  if (existsSync(tomlPath)) {
    const toml = readFileSync(tomlPath, "utf8");
    const urls = [...toml.matchAll(/^\s*base_url\s*=\s*["']([^"']+)["']/gm)].map((m) => m[1]);
    const ok = urls.some((u) => u.replace(/\/+$/, "") === `http://127.0.0.1:${port}/v1`);
    if (ok) check("Codex base_url 指向 bridge", true);
    else warn("Codex base_url 未指向 bridge", `当前：${urls.join(" | ") || "未找到"}；如需透明中转请改为 http://127.0.0.1:${port}/v1`);
  }
}

const fails = results.filter((r) => r.ok === false).length;
console.log(`\n体检结果：FAIL ${fails}，PASS ${results.length - fails}`);
process.exitCode = fails ? 1 : 0;
