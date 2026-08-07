/**
 * Bridge 用视觉服务商目录。
 * 与 scripts/provider-catalog.mjs 保持独立，避免 Bridge 被安装后依赖脚本目录。
 */
export const VISION_PROVIDERS = {
  zhipu: {
    id: "zhipu",
    name: "智谱 BigModel",
    style: "openai",
    keyEnv: ["ZHIPU_API_KEY", "GLM_API_KEY", "BIGMODEL_API_KEY"],
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4.6v",
  },
  siliconflow: {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    style: "openai",
    keyEnv: ["SILICONFLOW_API_KEY"],
    endpoint: "https://api.siliconflow.cn/v1/chat/completions",
    model: "Qwen/Qwen2.5-VL-7B-Instruct",
  },
  groq: {
    id: "groq",
    name: "Groq",
    style: "openai",
    keyEnv: ["GROQ_API_KEY"],
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.2-11b-vision-preview",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    style: "openai",
    keyEnv: ["OPENROUTER_API_KEY"],
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "Qwen/Qwen2.5-VL-7B-Instruct:free",
  },
  github: {
    id: "github",
    name: "GitHub Models",
    style: "openai",
    keyEnv: ["GITHUB_TOKEN"],
    endpoint: "https://models.inference.ai.azure.com/chat/completions",
    model: "gpt-4o-mini",
  },
  ollama: {
    id: "ollama",
    name: "本地 Ollama 开源视觉模型",
    style: "openai",
    requiresKey: false,
    keyEnv: ["OLLAMA_API_KEY"],
    endpoint: "http://127.0.0.1:11434/v1/chat/completions",
    model: "moondream",
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    style: "gemini",
    keyEnv: ["GEMINI_API_KEY"],
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    model: "gemini-2.5-flash",
  },
  cloudflare: {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    style: "cloudflare",
    keyEnv: ["CLOUDFLARE_API_TOKEN"],
    accountEnv: "CLOUDFLARE_ACCOUNT_ID",
    endpoint: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}",
    model: "@cf/meta/llama-3.2-11b-vision-instruct",
  },
};

export function resolveVisionProvider(id) {
  return VISION_PROVIDERS[String(id || "").toLowerCase()] || null;
}

export function resolveProviderKey(provider) {
  for (const name of provider.keyEnv || []) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

export function buildVisionEndpoint(provider, model, accountId = "") {
  let endpoint = provider.endpoint || "";
  if (endpoint.includes("{model}")) {
    endpoint = endpoint.replace("{model}", encodeURIComponent(model).replace(/%2F/gi, "/"));
  }
  if (endpoint.includes("{account}")) {
    const account = accountId || process.env[provider.accountEnv || ""]?.trim() || "";
    if (!account) {
      throw new Error(`${provider.name} 缺少 Account ID，请配置 ${provider.accountEnv || "visionAccountId"}`);
    }
    endpoint = endpoint.replace("{account}", encodeURIComponent(account));
  }
  return endpoint;
}