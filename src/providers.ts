/**
 * 多提供商注册表：免费视觉模型统一管理
 * 每个提供商声明：Key 环境变量、端点、模型清单（免费与否 + 说明）
 * 调用入口 callProvider() 按 provider.style 分发到对应客户端。
 */
import { chatGemini, chatOpenAICompat, type VisionChatResult } from "./client.js";

export interface ProviderModel {
  id: string;
  free: boolean;
  note: string;
  default?: boolean;
}

export interface Provider {
  id: string;
  name: string;
  keyEnv: string[];
  keyLabel: string;
  endpoint: string;
  style: "openai" | "gemini";
  accountEnv?: string;
  models: ProviderModel[];
}

export const PROVIDERS: Provider[] = [
  {
    id: "zhipu",
    name: "智谱 BigModel",
    keyEnv: ["ZHIPU_API_KEY", "GLM_API_KEY", "BIGMODEL_API_KEY"],
    keyLabel: "https://open.bigmodel.cn 的 API Keys（GLM-4.6V 注册送 600 万 tokens）",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    style: "openai",
    models: [
      { id: "glm-4.6v", free: true, note: "视觉旗舰，实测可用；账号赠送 600 万 tokens", default: true },
      { id: "glm-4.6v-flash", free: true, note: "免费 Flash 版，高峰期易 429" },
      { id: "glm-4.5v", free: false, note: "按量计费" },
    ],
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    keyEnv: ["SILICONFLOW_API_KEY"],
    keyLabel: "https://cloud.siliconflow.cn 注册即送 2000 万 tokens（含免费视觉模型）",
    endpoint: "https://api.siliconflow.cn/v1/chat/completions",
    style: "openai",
    models: [
      { id: "Qwen/Qwen2.5-VL-7B-Instruct", free: true, note: "免费" },
      { id: "Qwen/Qwen2.5-VL-32B-Instruct", free: true, note: "免费档" },
      { id: "Qwen/Qwen2.5-VL-72B-Instruct", free: true, note: "免费档" },
      { id: "Qwen/Qwen2-VL-7B-Instruct", free: true, note: "免费" },
      { id: "THUDM/glm-4v-9b", free: true, note: "免费" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    keyEnv: ["GROQ_API_KEY"],
    keyLabel: "https://console.groq.com/keys 免费注册",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    style: "openai",
    models: [
      { id: "llama-3.2-11b-vision-preview", free: true, note: "免费档（限速）" },
      { id: "llama-3.2-90b-vision-preview", free: true, note: "免费档（限速）" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    keyEnv: ["OPENROUTER_API_KEY"],
    keyLabel: "https://openrouter.ai/keys 免费注册",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    style: "openai",
    models: [
      { id: "Qwen/Qwen2.5-VL-7B-Instruct:free", free: true, note: "免费 :free" },
      { id: "Qwen/Qwen2.5-VL-32B-Instruct:free", free: true, note: "免费 :free" },
      { id: "meta-llama/llama-3.2-11b-vision-instruct:free", free: true, note: "免费 :free" },
      { id: "google/gemma-3-27b-it:free", free: true, note: "免费 :free（支持视觉）" },
    ],
  },
  {
    id: "github",
    name: "GitHub Models",
    keyEnv: ["GITHUB_TOKEN"],
    keyLabel: "GitHub → Settings → Developer settings → Personal access tokens（无需任何 scope）",
    endpoint: "https://models.inference.ai.azure.com/chat/completions",
    style: "openai",
    models: [
      { id: "gpt-4o-mini", free: true, note: "免费限速" },
      { id: "gpt-4o", free: true, note: "免费限速" },
      { id: "Llama-3.2-11B-Vision-Instruct", free: true, note: "免费限速" },
      { id: "Phi-3.5-vision-instruct", free: true, note: "免费限速" },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    keyEnv: ["GEMINI_API_KEY"],
    keyLabel: "https://aistudio.google.com/apikey 免费 Key（自带免费档额度）",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    style: "gemini",
    models: [
      { id: "gemini-2.5-flash", free: true, note: "免费档（限速）" },
      { id: "gemini-2.0-flash", free: true, note: "免费档（限速）" },
    ],
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    keyEnv: ["CLOUDFLARE_API_TOKEN"],
    keyLabel: "https://dash.cloudflare.com → Workers AI，每天 1 万 neurons 免费",
    accountEnv: "CLOUDFLARE_ACCOUNT_ID",
    endpoint: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}",
    style: "openai",
    models: [
      { id: "@cf/meta/llama-3.2-11b-vision-instruct", free: true, note: "免费额度内" },
      { id: "@cf/qwen/qwen2.5-vl-7b-instruct", free: true, note: "免费额度内" },
    ],
  },
];

/** 读取 provider 的 API Key（空串视为未配置） */
export function resolveProviderKey(p: Provider): string | undefined {
  for (const name of p.keyEnv) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** 各 provider 的 Key 配置状态（不泄露 Key 本身） */
export function providerKeyStatus(): { id: string; name: string; configured: boolean }[] {
  return PROVIDERS.map((p) => ({ id: p.id, name: p.name, configured: Boolean(resolveProviderKey(p)) }));
}

/** 根据 endpoint 模板替换 {model} / {account} 占位符 */
function buildEndpoint(p: Provider, modelId: string): string {
  let ep = p.endpoint;
  if (ep.includes("{model}")) {
    ep = ep.replace("{model}", encodeURIComponent(modelId));
  }
  if (ep.includes("{account}")) {
    const account = process.env[p.accountEnv ?? ""]?.trim();
    if (!account) throw new Error(`缺少 ${p.accountEnv}（Cloudflare 账号 ID），请在客户端配置 env 中设置`);
    ep = ep.replace("{account}", encodeURIComponent(account));
  }
  return ep;
}

export interface ModelRef {
  provider: Provider;
  model: ProviderModel;
}

/**
 * 解析模型引用：
 * - "provider/模型名"（如 zhipu/glm-4.6v、siliconflow/Qwen/Qwen2.5-VL-7B-Instruct）
 * - 裸模型名：先查智谱（保持旧配置兼容），再全局精确匹配
 * - 只给 provider：用该 provider 的默认/第一个模型
 * - 都不给：默认 zhipu/glm-4.6v
 */
export function resolveModelRef(opts: { model?: string; provider?: string }): ModelRef {
  if (opts.provider) {
    const pid = opts.provider.toLowerCase();
    const p = PROVIDERS.find((x) => x.id === pid);
    if (!p) throw new Error(`未知 provider：${opts.provider}（可用：${PROVIDERS.map((x) => x.id).join(" / ")}）`);
    if (opts.model) {
      const modelId = opts.model.startsWith(`${pid}/`) ? opts.model.slice(pid.length + 1) : opts.model;
      const m = p.models.find((x) => x.id === modelId);
      if (!m)
        throw new Error(`provider ${p.id} 没有模型 ${opts.model}，可用：${p.models.map((x) => x.id).join(", ")}`);
      return { provider: p, model: m };
    }
    return { provider: p, model: p.models.find((x) => x.default) ?? p.models[0] };
  }

  if (opts.model) {
    const m = opts.model;
    // 带 provider 前缀
    const slash = m.indexOf("/");
    if (slash > 0) {
      const pid = m.slice(0, slash).toLowerCase();
      const p = PROVIDERS.find((x) => x.id === pid);
      if (p) {
        const modelId = m.slice(slash + 1);
        const mm = p.models.find((x) => x.id === modelId);
        if (!mm) throw new Error(`provider ${p.id} 没有模型 ${modelId}，可用：${p.models.map((x) => x.id).join(", ")}`);
        return { provider: p, model: mm };
      }
    }
    // 裸模型名：先查智谱，再全局精确匹配
    const zp = PROVIDERS.find((x) => x.id === "zhipu")!;
    const zm = zp.models.find((x) => x.id === m);
    if (zm) return { provider: zp, model: zm };
    for (const p of PROVIDERS) {
      const mm = p.models.find((x) => x.id === m);
      if (mm) return { provider: p, model: mm };
    }
    throw new Error(`未知模型：${m}。可先用 list_models 查看全部可用模型`);
  }

  const zp = PROVIDERS.find((x) => x.id === "zhipu")!;
  return { provider: zp, model: zp.models.find((x) => x.default) ?? zp.models[0] };
}

export interface CallOpts {
  imageUrl: string;
  prompt: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/** 调用指定 provider 的模型（按 style 分发协议） */
export async function callProvider(ref: ModelRef, opts: CallOpts): Promise<VisionChatResult> {
  const key = resolveProviderKey(ref.provider);
  if (!key) {
    throw new Error(
      `${ref.provider.name} 未配置 API Key：请设置环境变量 ${ref.provider.keyEnv.join(" 或 ")}（申请入口：${ref.provider.keyLabel}）`,
    );
  }
  const endpoint = buildEndpoint(ref.provider, ref.model.id);
  const base = {
    imageUrl: opts.imageUrl,
    prompt: opts.prompt,
    model: ref.model.id,
    apiKey: key,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    timeoutMs: opts.timeoutMs,
  };
  if (ref.provider.style === "gemini") return chatGemini({ ...base, endpoint });
  return chatOpenAICompat({ ...base, endpoint });
}
