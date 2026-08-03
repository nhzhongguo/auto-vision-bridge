/**
 * 通用模型调用客户端
 * - chatOpenAICompat：OpenAI 兼容协议（智谱 / 硅基流动 / Groq / OpenRouter / GitHub Models / Cloudflare Workers AI）
 * - chatGemini：Google Gemini 专用协议
 */
import { mimeFromBuffer } from "./image.js";

export const MAX_RETRIES = 2; // 429/5xx 自动重试次数
const RETRY_BASE_DELAY_MS = 3000; // 指数退避基数

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface VisionChatParams {
  imageUrl: string;
  prompt: string;
  model: string;
  apiKey: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface VisionChatResult {
  text: string;
  model: string;
  usage?: Record<string, unknown>;
  retries?: number;
}

function parseOpenAIResult(data: any, fallbackModel: string, retries: number): VisionChatResult {
  const reasoning: string = data?.choices?.[0]?.message?.reasoning_content ?? "";
  // 推理模型：token 耗尽时 content 可能为空，回退返回推理内容避免空结果
  const text: string = data?.choices?.[0]?.message?.content ?? (reasoning ? reasoning : "");
  if (!text && data?.choices?.[0]?.finish_reason === "length") {
    throw new Error("输出被 max_tokens 截断（推理内容已占满额度），请增大 max_tokens 后重试");
  }
  if (!text) throw new Error(`模型返回了空内容：${JSON.stringify(data).slice(0, 300)}`);
  return {
    text,
    model: data?.model ?? fallbackModel,
    usage: data?.usage ?? undefined,
    retries,
  };
}

/** OpenAI 兼容协议：messages[{role, content:[{type:text},{type:image_url}]}] */
export async function chatOpenAICompat(params: VisionChatParams): Promise<VisionChatResult> {
  const endpoint = params.endpoint;
  if (!endpoint) throw new Error("缺少 API 端点配置（provider.endpoint 未设置）");
  const body = {
    model: params.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: params.prompt },
          { type: "image_url", image_url: { url: params.imageUrl } },
        ],
      },
    ],
    temperature: params.temperature ?? 0.7,
    max_tokens: params.maxTokens ?? 2048,
    top_p: 0.95,
    stream: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 120_000);
  let retries = 0;

  try {
    for (let attempt = 0; ; attempt++) {
      let resp: Response;
      try {
        resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${params.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err: any) {
        if (err?.name === "AbortError") throw new Error(`请求超时（${(params.timeoutMs ?? 120_000) / 1000}s）`);
        if (attempt < MAX_RETRIES) {
          retries++;
          await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
          continue;
        }
        throw err;
      }

      const data: any = await resp.json().catch(() => null);
      if (resp.ok) return parseOpenAIResult(data, params.model, retries);

      const msg = data?.error?.message ?? data?.message ?? (data ? JSON.stringify(data) : `HTTP ${resp.status}`);
      const retryable = resp.status === 429 || resp.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        retries++;
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }
      throw new Error(`API 错误 ${resp.status}: ${msg}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** 把图片 URL 转成 Gemini 需要的 inline_data（base64） */
async function imageUrlToInline(imageUrl: string): Promise<{ mime: string; data: string }> {
  if (imageUrl.startsWith("data:")) {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(imageUrl);
    if (!m) throw new Error("Gemini 需要 base64 data URL，无法解析该输入");
    return { mime: m[1], data: m[2] };
  }
  if (/^https?:\/\//i.test(imageUrl)) {
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`下载图片失败：HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const mime = mimeFromBuffer(buf);
    if (!mime) throw new Error("下载的图片无法识别格式");
    return { mime, data: buf.toString("base64") };
  }
  throw new Error("Gemini 仅支持 data URL 或 http(s) 图片地址");
}

/** Google Gemini 协议：contents[{parts:[{text},{inline_data}]}] */
export async function chatGemini(params: VisionChatParams): Promise<VisionChatResult> {
  const { mime, data } = await imageUrlToInline(params.imageUrl);
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: params.prompt },
          { inline_data: { mime_type: mime, data } },
        ],
      },
    ],
    generationConfig: {
      temperature: params.temperature ?? 0.7,
      maxOutputTokens: params.maxTokens ?? 2048,
    },
  };

  const base =
    params.endpoint ??
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent`;
  const sep = base.includes("?") ? "&" : "?";
  const url = `${base}${sep}key=${encodeURIComponent(params.apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 120_000);
  let retries = 0;

  try {
    for (let attempt = 0; ; attempt++) {
      let resp: Response;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err: any) {
        if (err?.name === "AbortError") throw new Error(`请求超时（${(params.timeoutMs ?? 120_000) / 1000}s）`);
        if (attempt < MAX_RETRIES) {
          retries++;
          await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
          continue;
        }
        throw err;
      }

      const data: any = await resp.json().catch(() => null);
      if (resp.ok) {
        const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
        const text = parts
          .map((p: any) => p.text ?? "")
          .join("")
          .trim();
        if (!text) {
          const reason = data?.candidates?.[0]?.finishReason ?? "";
          throw new Error(`Gemini 返回了空内容（finishReason=${reason}）`);
        }
        return {
          text,
          model: data?.modelVersion ?? params.model,
          usage: data?.usageMetadata ?? undefined,
          retries,
        };
      }

      const msg = data?.error?.message ?? (data ? JSON.stringify(data) : `HTTP ${resp.status}`);
      const retryable = resp.status === 429 || resp.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        retries++;
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }
      throw new Error(`Gemini API 错误 ${resp.status}: ${msg}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
