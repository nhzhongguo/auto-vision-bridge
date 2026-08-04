/**
 * 统一配置与提供商入口
 * 供 Bridge (bridge/server.mjs) 和 MCP Server (src/index.ts) 共用
 */
export { loadConfig, getConfig, reloadConfig, getBridgeConfig } from "./config.js";
export type { BridgeConfig, UnifiedConfig, VisionProvider } from "./config.js";

// 重新导出提供商注册表
export { PROVIDERS, resolveProviderKey, providerKeyStatus, resolveModelRef, callProvider } from "./providers.js";
export type { Provider, ProviderModel, ModelRef, CallOpts } from "./providers.js";

// 重新导出客户端函数
export { chatOpenAICompat, chatGemini, type VisionChatParams, type VisionChatResult } from "./client.js";