/**
 * 配置向导使用的内置视觉模型目录（零依赖，可直接被 Node.js 加载）。
 *
 * billing 只表示当前目录中的风险提示，不是永久价格承诺：
 * - free：服务商标注为免费额度/免费档，仍可能受限流或额度影响；
 * - paid：按量计费或需要余额；
 * - unknown：自定义模型或价格随账号套餐变化，默认按可能收费处理。
 */
export const BILLING_LABELS = {
  free: "免费额度/免费档（可能限流或耗尽额度）",
  paid: "可能产生费用（按服务商计费规则扣费）",
  unknown: "价格未知（按可能产生费用处理）",
};

export const PROVIDERS = [
  {
    id: "zhipu",
    name: "智谱 BigModel",
    keyUrl: "https://open.bigmodel.cn → API Keys",
    keyHint: "支持环境变量：ZHIPU_API_KEY / GLM_API_KEY / BIGMODEL_API_KEY",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    style: "openai",
    models: [
      { id: "glm-4.6v", vision: true, billing: "free", note: "推荐；视觉模型，免费额度" },
      { id: "glm-4.6v-flash", vision: true, billing: "free", note: "免费 Flash 档，可能限流" },
      { id: "glm-4.5v", vision: true, billing: "paid", note: "视觉模型，按量计费" },
    ],
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    keyUrl: "https://cloud.siliconflow.cn → API 密钥",
    keyHint: "环境变量：SILICONFLOW_API_KEY",
    endpoint: "https://api.siliconflow.cn/v1/chat/completions",
    style: "openai",
    models: [
      { id: "Qwen/Qwen2.5-VL-7B-Instruct", vision: true, billing: "free", note: "免费档" },
      { id: "Qwen/Qwen2.5-VL-32B-Instruct", vision: true, billing: "free", note: "免费档" },
      { id: "Qwen/Qwen2.5-VL-72B-Instruct", vision: true, billing: "free", note: "免费档" },
      { id: "Qwen/Qwen2-VL-7B-Instruct", vision: true, billing: "free", note: "免费档" },
      { id: "THUDM/glm-4v-9b", vision: true, billing: "free", note: "免费档" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    keyUrl: "https://console.groq.com/keys",
    keyHint: "环境变量：GROQ_API_KEY",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    style: "openai",
    models: [
      { id: "llama-3.2-11b-vision-preview", vision: true, billing: "free", note: "免费档，限速" },
      { id: "llama-3.2-90b-vision-preview", vision: true, billing: "free", note: "免费档，限速" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "环境变量：OPENROUTER_API_KEY",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    style: "openai",
    models: [
      { id: "Qwen/Qwen2.5-VL-7B-Instruct:free", vision: true, billing: "free", note: ":free 模型" },
      { id: "Qwen/Qwen2.5-VL-32B-Instruct:free", vision: true, billing: "free", note: ":free 模型" },
      { id: "meta-llama/llama-3.2-11b-vision-instruct:free", vision: true, billing: "free", note: ":free 模型" },
      { id: "google/gemma-3-27b-it:free", vision: true, billing: "free", note: ":free 模型" },
    ],
  },
  {
    id: "github",
    name: "GitHub Models",
    keyUrl: "GitHub → Settings → Developer settings → Personal access tokens",
    keyHint: "环境变量：GITHUB_TOKEN",
    endpoint: "https://models.inference.ai.azure.com/chat/completions",
    style: "openai",
    models: [
      { id: "gpt-4o-mini", vision: true, billing: "free", note: "免费限速/按账号额度" },
      { id: "gpt-4o", vision: true, billing: "free", note: "免费限速/按账号额度" },
      { id: "Llama-3.2-11B-Vision-Instruct", vision: true, billing: "free", note: "免费限速/按账号额度" },
      { id: "Phi-3.5-vision-instruct", vision: true, billing: "free", note: "免费限速/按账号额度" },
    ],
  },
  {
    id: "ollama",
    name: "本地 Ollama 开源视觉模型",
    keyUrl: "无需 API Key，需安装 Ollama：https://ollama.com/download",
    keyHint: "本地模式不填写 API Key；请先安装 Ollama，再运行 node scripts/install-local-model.mjs",
    endpoint: "http://127.0.0.1:11434/v1/chat/completions",
    style: "openai",
    local: true,
    models: [
      { id: "moondream", vision: true, billing: "free", note: "轻量本地识图，CPU 可跑，推荐", default: true },
      { id: "qwen2.5vl:3b", vision: true, billing: "free", note: "本地识图更强，需先 ollama pull qwen2.5vl:3b" },
      { id: "qwen2.5vl:7b", vision: true, billing: "free", note: "更强但更大，需先 ollama pull qwen2.5vl:7b" },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "环境变量：GEMINI_API_KEY",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    style: "gemini",
    models: [
      { id: "gemini-2.5-flash", vision: true, billing: "free", note: "免费档，限速" },
      { id: "gemini-2.0-flash", vision: true, billing: "free", note: "免费档，限速" },
    ],
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    keyUrl: "https://dash.cloudflare.com → Workers AI",
    keyHint: "环境变量：CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID",
    endpoint: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}",
    style: "cloudflare",
    models: [
      { id: "@cf/meta/llama-3.2-11b-vision-instruct", vision: true, billing: "free", note: "免费额度内" },
      { id: "@cf/qwen/qwen2.5-vl-7b-instruct", vision: true, billing: "free", note: "免费额度内" },
    ],
  },
];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}

export function getDefaultModel(provider) {
  return provider?.models?.find((m) => m.default) ?? provider?.models?.[0];
}

export function billingLabel(model) {
  return BILLING_LABELS[model?.billing ?? "unknown"] ?? BILLING_LABELS.unknown;
}
