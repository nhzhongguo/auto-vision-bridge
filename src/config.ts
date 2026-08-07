/**
 * 统一配置管理模块
 * - 同时供 Bridge (bridge/server.mjs) 和 MCP Server (src/index.ts) 使用
 * - 使用 Zod 进行 Schema 验证
 * - 支持从 bridge/config.json + 环境变量加载配置
 */
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BRIDGE_CONFIG_PATH = join(ROOT, "bridge", "config.json");

/** 视觉提供商配置 */
export const VisionProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyEnv: z.array(z.string()),
  keyLabel: z.string(),
  endpoint: z.string().url(),
  style: z.enum(["openai", "gemini", "cloudflare"]),
  accountEnv: z.string().optional(),
  models: z.array(
    z.object({
      id: z.string(),
      free: z.boolean(),
      note: z.string(),
      default: z.boolean().optional(),
    })
  ),
});

export type VisionProvider = z.infer<typeof VisionProviderSchema>;

/** Bridge 核心配置 */
export const BridgeConfigSchema = z.object({
  /** 监听地址 */
  listen: z.string().default("127.0.0.1"),
  /** 监听端口 */
  port: z.number().int().min(1).max(65535).default(57399),
  /** 上游模型服务地址（不带 /v1） */
  upstream: z.string().url().default("http://127.0.0.1:57321"),

  /** 视觉模型配置（主视觉提供商，兼容旧字段） */
  visionProvider: z.string().default("zhipu"),
  visionModel: z.string().default("glm-4.6v"),
  visionBaseUrl: z.string().url().default("https://open.bigmodel.cn/api/paas/v4/chat/completions"),
  visionApiKey: z.string().default(""),
  visionAccountId: z.string().default(""),
  visionPrompt: z.string().default(
    "这是一张用户发送的图片。请完整描述图片内容，包括：1) 图中所有可见文字（OCR，原样输出并注意排版）；2) 场景与主体；3) 物体、人物、动作、布局；4) 颜色与风格。用中文回答。"
  ),
  visionTimeoutMs: z.number().int().positive().default(120000),

  /** 备用视觉提供商（故障转移用） */
  fallbackVisionProviders: z.array(z.string()).default([]),

  /** 缓存配置 */
  cacheSize: z.number().int().positive().default(300),
  maxDescChars: z.number().int().positive().default(4000),

  /** 模型判断白/黑名单 */
  visionModels: z.array(z.string()).default([
    "gpt-4o", "gpt-4.1", "gpt-5", "o1", "o3", "o4", "o5",
    "claude", "gemini",
    "qwen-vl", "qwen2.5-vl", "qwen3-vl",
    "glm-4v", "glm-4.5v", "glm-4.6v",
    "llava", "internvl", "minicpm-v", "step-1v", "spark-vision", "doubao-vision", "hunyuan-vision"
  ]),
  nonVisionModels: z.array(z.string()).default([
    "deepseek", "kimi", "moonshot", "ernie", "baichuan", "minimax",
    "glm-4-flash", "glm-4-air", "glm-4-plus", "glm-4-long", "glm-4-0520",
    "qwen-turbo", "qwen-plus", "qwen-max", "qwen-long", "qwen-lite"
  ]),

  /** 模型别名：客户端模型名 -> 上游真实模型名 */
  modelAliases: z.record(z.string(), z.string()).default({}),

  /** 调用视觉模型时的提示文本 */
  noticeEnabled: z.boolean().default(true),
  noticeText: z.string().default("📷 检测到当前模型不支持直接看图，正在调用视觉模型识别图片…\n"),

  /** 允许 bridge 主动抓取内网图片（默认关闭，避免 SSRF） */
  allowPrivateImageUrls: z.boolean().default(false),
  /** 请求体大小限制（字节） */
  maxRequestBodySize: z.number().int().positive().default(100 * 1024 * 1024), // 100MB

  /** 日志配置 */
  logFile: z.string().default(join(ROOT, "bridge", "bridge.log")),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;

/** 完整配置（Bridge + MCP 共享） */
export const UnifiedConfigSchema = z.object({
  bridge: BridgeConfigSchema,
  /** MCP Server 相关配置（未来扩展） */
  mcp: z.object({
    defaultProvider: z.string().default("zhipu"),
    defaultModel: z.string().default("glm-4.6v"),
  }).default(() => ({ defaultProvider: "zhipu", defaultModel: "glm-4.6v" })),
});

export type UnifiedConfig = z.infer<typeof UnifiedConfigSchema>;

/** 默认配置 */
const DEFAULT_BRIDGE_CONFIG: BridgeConfig = BridgeConfigSchema.parse({});

/** 加载并验证配置 */
export function loadConfig(): UnifiedConfig {
  // 1. 读取 bridge/config.json
  let fileConfig: Partial<BridgeConfig> = {};
  if (existsSync(BRIDGE_CONFIG_PATH)) {
    try {
      const content = readFileSync(BRIDGE_CONFIG_PATH, "utf8");
      fileConfig = JSON.parse(content);
    } catch (e) {
      console.error(`[config] 读取配置文件失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. 环境变量覆盖（优先级最高）
  const envOverrides: Partial<BridgeConfig> = {};
  if (process.env.BRIDGE_LISTEN) envOverrides.listen = process.env.BRIDGE_LISTEN;
  if (process.env.BRIDGE_PORT) envOverrides.port = parseInt(process.env.BRIDGE_PORT, 10);
  if (process.env.BRIDGE_UPSTREAM) envOverrides.upstream = process.env.BRIDGE_UPSTREAM;
  if (process.env.VISION_API_KEY) envOverrides.visionApiKey = process.env.VISION_API_KEY;
  if (process.env.VISION_ACCOUNT_ID) envOverrides.visionAccountId = process.env.VISION_ACCOUNT_ID;
  if (process.env.ALLOW_PRIVATE_IMAGE_URLS) envOverrides.allowPrivateImageUrls = process.env.ALLOW_PRIVATE_IMAGE_URLS === "true";
  if (process.env.VISION_MODEL) envOverrides.visionModel = process.env.VISION_MODEL;
  if (process.env.VISION_BASE_URL) envOverrides.visionBaseUrl = process.env.VISION_BASE_URL;
  if (process.env.VISION_PROVIDER) envOverrides.visionProvider = process.env.VISION_PROVIDER;
  if (process.env.LOG_LEVEL) envOverrides.logLevel = process.env.LOG_LEVEL as BridgeConfig["logLevel"];

  // 3. 合并配置：默认值 < 文件配置 < 环境变量
  const merged = {
    ...DEFAULT_BRIDGE_CONFIG,
    ...fileConfig,
    ...envOverrides,
  };

  // 4. 兼容旧字段名（zhipuApiKey -> visionApiKey）
  if ((fileConfig as any).zhipuApiKey && !merged.visionApiKey) {
    merged.visionApiKey = (fileConfig as any).zhipuApiKey;
  }

  // 5. 验证
  const bridgeConfig = BridgeConfigSchema.parse(merged);

  return {
    bridge: bridgeConfig,
    mcp: {
      defaultProvider: bridgeConfig.visionProvider,
      defaultModel: bridgeConfig.visionModel,
    },
  };
}

/** 单例配置实例 */
let configInstance: UnifiedConfig | null = null;

export function getConfig(): UnifiedConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

export function reloadConfig(): UnifiedConfig {
  configInstance = loadConfig();
  return configInstance;
}

/** 获取 Bridge 配置（便捷方法） */
export function getBridgeConfig(): BridgeConfig {
  return getConfig().bridge;
}

/** 获取视觉提供商配置（从 PROVIDERS 注册表查找） */
export function getVisionProviderConfig(providerId?: string): VisionProvider | undefined {
  // 这里需要从 providers.ts 导入 PROVIDERS，避免循环依赖
  // 调用方应自行导入 PROVIDERS 并查找
  return undefined;
}
