/**
 * Bridge 统一配置加载器（零依赖版本）
 * - 与 src/config.ts 共享配置结构，但不依赖 Zod
 * - 供 bridge/server.mjs 直接 import 使用
 */
import { readFileSync, existsSync, watch } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BRIDGE_CONFIG_PATH = join(ROOT, "bridge", "config.json");

/** 默认配置 */
const DEFAULT_CONFIG = {
  listen: "127.0.0.1",
  port: 57399,
  upstream: "http://127.0.0.1:57321",

  visionProvider: "zhipu",
  visionModel: "glm-4.6v",
  visionBaseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  visionApiKey: "",
  visionPrompt:
    "这是一张用户发送的图片。请完整描述图片内容，包括：1) 图中所有可见文字（OCR，原样输出并注意排版）；2) 场景与主体；3) 物体、人物、动作、布局；4) 颜色与风格。用中文回答。",
  visionTimeoutMs: 120000,

  fallbackVisionProviders: [],

  cacheSize: 300,
  maxDescChars: 4000,

  visionModels: [
    "gpt-4o", "gpt-4.1", "gpt-5", "o1", "o3", "o4", "o5",
    "claude", "gemini",
    "qwen-vl", "qwen2.5-vl", "qwen3-vl",
    "glm-4v", "glm-4.5v", "glm-4.6v",
    "llava", "internvl", "minicpm-v", "step-1v", "spark-vision", "doubao-vision", "hunyuan-vision"
  ],
  nonVisionModels: [
    "deepseek", "kimi", "moonshot", "ernie", "baichuan", "minimax",
    "glm-4-flash", "glm-4-air", "glm-4-plus", "glm-4-long", "glm-4-0520",
    "qwen-turbo", "qwen-plus", "qwen-max", "qwen-long", "qwen-lite"
  ],

  modelAliases: {},

  noticeEnabled: true,
  noticeText: "📷 检测到当前模型不支持直接看图，正在调用视觉模型识别图片…\n",

  maxRequestBodySize: 100 * 1024 * 1024,

  logFile: join(ROOT, "bridge", "bridge.log"),
  logLevel: "info",
};

/** 简单的类型检查和默认值填充 */
function validateAndFill(config) {
  const result = { ...DEFAULT_CONFIG };

  for (const [key, defaultValue] of Object.entries(DEFAULT_CONFIG)) {
    if (config[key] !== undefined) {
      // 类型检查
      if (typeof defaultValue === "number" && typeof config[key] === "number") {
        result[key] = config[key];
      } else if (typeof defaultValue === "string" && typeof config[key] === "string") {
        result[key] = config[key];
      } else if (typeof defaultValue === "boolean" && typeof config[key] === "boolean") {
        result[key] = config[key];
      } else if (Array.isArray(defaultValue) && Array.isArray(config[key])) {
        result[key] = config[key];
      } else if (typeof defaultValue === "object" && defaultValue !== null && !Array.isArray(defaultValue)) {
        result[key] = { ...defaultValue, ...config[key] };
      } else {
        result[key] = config[key];
      }
    }
  }

  return result;
}

/** 加载配置文件 */
function loadConfigFile() {
  if (existsSync(BRIDGE_CONFIG_PATH)) {
    try {
      const content = readFileSync(BRIDGE_CONFIG_PATH, "utf8");
      return JSON.parse(content);
    } catch (e) {
      console.error(`[config] 读取配置文件失败: ${e.message}`);
    }
  }
  return {};
}

/** 环境变量覆盖 */
function applyEnvOverrides(config) {
  const overrides = {};

  if (process.env.BRIDGE_LISTEN) overrides.listen = process.env.BRIDGE_LISTEN;
  if (process.env.BRIDGE_PORT) overrides.port = parseInt(process.env.BRIDGE_PORT, 10);
  if (process.env.BRIDGE_UPSTREAM) overrides.upstream = process.env.BRIDGE_UPSTREAM;
  if (process.env.VISION_API_KEY) overrides.visionApiKey = process.env.VISION_API_KEY;
  if (process.env.VISION_MODEL) overrides.visionModel = process.env.VISION_MODEL;
  if (process.env.VISION_BASE_URL) overrides.visionBaseUrl = process.env.VISION_BASE_URL;
  if (process.env.VISION_PROVIDER) overrides.visionProvider = process.env.VISION_PROVIDER;
  if (process.env.LOG_LEVEL) overrides.logLevel = process.env.LOG_LEVEL;
  if (process.env.MAX_REQUEST_BODY_SIZE) overrides.maxRequestBodySize = parseInt(process.env.MAX_REQUEST_BODY_SIZE, 10);
  if (process.env.CACHE_SIZE) overrides.cacheSize = parseInt(process.env.CACHE_SIZE, 10);

  return { ...config, ...overrides };
}

/** 兼容旧字段名 */
function applyLegacyCompat(config) {
  if (config.zhipuApiKey && !config.visionApiKey) {
    config.visionApiKey = config.zhipuApiKey;
  }
  if (config.visionBaseUrl && !config.visionBaseUrl) {
    // 已经有了
  }
  return config;
}

/** 当前配置实例 */
let currentConfig = null;
let configWatchers = [];

/** 获取当前配置 */
export function getBridgeConfig() {
  if (!currentConfig) {
    reloadConfig();
  }
  return currentConfig;
}

/** 重新加载配置 */
export function reloadConfig() {
  const fileConfig = loadConfigFile();
  const merged = applyLegacyCompat({ ...DEFAULT_CONFIG, ...fileConfig });
  currentConfig = applyEnvOverrides(merged);
  return currentConfig;
}

/** 监听配置文件变化，支持热重载 */
export function watchConfig(onChange) {
  if (!existsSync(BRIDGE_CONFIG_PATH)) {
    return () => {};
  }

  const watcher = watch(BRIDGE_CONFIG_PATH, (eventType) => {
    if (eventType === "change") {
      // 延迟一点，避免文件还在写入中
      setTimeout(() => {
        try {
          const oldConfig = currentConfig;
          reloadConfig();
          if (onChange) {
            onChange(currentConfig, oldConfig);
          }
        } catch (e) {
          console.error(`[config] 热重载失败: ${e.message}`);
        }
      }, 100);
    }
  });

  configWatchers.push(watcher);
  return () => {
    watcher.close();
    configWatchers = configWatchers.filter(w => w !== watcher);
  };
}

/** 停止所有监听 */
export function stopWatching() {
  for (const watcher of configWatchers) {
    watcher.close();
  }
  configWatchers = [];
}

/** 获取默认配置（用于生成示例） */
export function getDefaultConfig() {
  return { ...DEFAULT_CONFIG };
}