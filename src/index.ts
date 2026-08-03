#!/usr/bin/env node
/**
 * Vision-MCP Server（多提供商）
 * 给 DeepSeek 等纯文本模型补充图片理解能力，底层可切换多家免费视觉模型：
 * 智谱 GLM-4.6V / 硅基流动 Qwen-VL / Groq Llama-Vision / OpenRouter :free / GitHub Models / Gemini / Cloudflare
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { normalizeImageSource } from "./image.js";
import { PROVIDERS, callProvider, providerKeyStatus, resolveModelRef } from "./providers.js";

const server = new McpServer({
  name: "glm-vision-mcp",
  version: "1.1.0",
});

server.tool(
  "analyze_image",
  "使用已配置的免费视觉模型分析图片并回答问题。image 支持：本地绝对/相对路径、http(s) 图片 URL、data URL、base64 字符串。model 可用 list_models 查看全部；格式：裸模型名（默认走智谱）或 provider/模型名，如 siliconflow/Qwen/Qwen2.5-VL-7B-Instruct。给 DeepSeek 等无视觉模型提供看图能力。",
  {
    image: z
      .string()
      .describe("图片来源：本地文件路径 / http(s) 图片 URL / data URL / base64 字符串"),
    prompt: z
      .string()
      .optional()
      .describe("对图片提出的问题或指令，例如「这张图里有什么」「提取图中文字」"),
    model: z
      .string()
      .optional()
      .describe("模型名（可带 provider 前缀），默认 glm-4.6v（智谱，免费额度）"),
    provider: z
      .string()
      .optional()
      .describe(`强制指定提供商（${PROVIDERS.map((x) => x.id).join(" / ")}），此时 model 可省略`),
    max_tokens: z
      .number()
      .int()
      .min(1)
      .max(8192)
      .optional()
      .describe("最大输出 token 数，默认 2048（GLM-4.6V 为推理模型，建议 ≥2048）"),
    temperature: z.number().min(0).max(2).optional().describe("采样温度，默认 0.7"),
  },
  async ({ image, prompt, model, provider, max_tokens, temperature }) => {
    try {
      const { url, note } = await normalizeImageSource(image);
      const ref = resolveModelRef({ model, provider });
      const result = await callProvider(ref, {
        imageUrl: url,
        prompt: prompt ?? "请详细描述这张图片的内容。",
        model: ref.model.id,
        maxTokens: max_tokens ?? 2048,
        temperature: temperature ?? 0.7,
      });

      const meta = {
        provider: ref.provider.id,
        providerName: ref.provider.name,
        input: note,
        model: result.model,
        usage: result.usage ?? null,
      };

      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: { answer: result.text, ...meta },
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `❌ 分析失败：${err?.message ?? String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "list_models",
  "列出全部可用的视觉模型提供商与模型清单（免费/计费标注），以及各提供商 API Key 是否已配置。",
  {},
  async () => {
    const status = new Map(providerKeyStatus().map((s) => [s.id, s]));
    const lines: string[] = [];
    const flat: any[] = [];
    for (const p of PROVIDERS) {
      const st = status.get(p.id)!;
      lines.push(
        `[${p.id}] ${p.name} — Key ${st.configured ? "✅ 已配置" : "❌ 未配置"}（${p.keyEnv.join("/")}）`,
      );
      for (const m of p.models) {
        lines.push(`  ${m.id}${m.default ? "（默认）" : ""} · ${m.free ? "免费" : "计费"} · ${m.note}`);
        flat.push({ provider: p.id, model: m.id, free: m.free, note: m.note, default: Boolean(m.default) });
      }
    }
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      structuredContent: { providers: flat, keyStatus: providerKeyStatus() },
    };
  },
);

server.tool(
  "get_server_info",
  "查看本 MCP server 的配置状态：默认模型、各提供商 Key 是否已配置（只返回布尔值，不泄露 Key）、支持的输入格式。",
  {},
  async () => {
    const status = providerKeyStatus();
    const configured = status.filter((s) => s.configured).map((s) => s.id);
    const lines = [
      `默认模型: glm-4.6v（智谱，免费额度 600 万 tokens）`,
      `支持提供商: ${PROVIDERS.length} 个（${PROVIDERS.map((x) => x.id).join(" / ")}）`,
      `已配置 Key: ${configured.length ? configured.join(" / ") : "无（用 list_models 查看申请入口）"}`,
      `支持输入: 本地路径 / http(s) URL / data URL / base64`,
      `最大图片: 15MB`,
    ];
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      structuredContent: {
        defaultModel: "glm-4.6v",
        providers: status,
        maxImageBytes: 15 * 1024 * 1024,
      },
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
