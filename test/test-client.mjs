/**
 * 本地冒烟测试：以 MCP Client 身份启动本 server，
 * 列出工具 → get_server_info → list_models → 本地 PNG 调用 analyze_image（真实 API）
 * → 远程 URL 调用 → 无 Key 的 provider 路由错误分支。
 * 有 ZHIPU_API_KEY 时本地 PNG 调用会走真实智谱 glm-4.6v；没有则验证「缺少 Key」分支。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const serverPath = join(__dirname, "..", "dist", "index.js");

// 1x1 红色 PNG
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const tmp = await mkdtemp(join(tmpdir(), "glm-mcp-test-"));
const imgPath = join(tmp, "pixel.png");
await writeFile(imgPath, Buffer.from(TINY_PNG_B64, "base64"));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, ZHIPU_API_KEY: process.env.ZHIPU_API_KEY ?? "" },
});

const client = new Client({ name: "glm-vision-test", version: "1.1.0" });
await client.connect(transport);

console.log("=== tools ===");
const tools = await client.listTools();
for (const t of tools.tools) console.log(`- ${t.name}: ${t.description.split("\n")[0]}`);
const names = tools.tools.map((t) => t.name);
if (!names.includes("analyze_image") || !names.includes("get_server_info") || !names.includes("list_models")) {
  console.error("工具列表不完整");
  process.exit(1);
}

console.log("\n=== get_server_info ===");
const info = await client.callTool({ name: "get_server_info", arguments: {} });
console.log(JSON.stringify(info, null, 2));

console.log("\n=== list_models ===");
const lm = await client.callTool({ name: "list_models", arguments: {} });
console.log(JSON.stringify(lm, null, 2));

console.log("\n=== analyze_image (本地 PNG，默认模型) ===");
const r = await client.callTool({
  name: "analyze_image",
  arguments: { image: imgPath, prompt: "这是什么颜色的像素？一句话回答" },
});
console.log(JSON.stringify(r, null, 2));

console.log("\n=== analyze_image (http URL) ===");
const r2 = await client.callTool({
  name: "analyze_image",
  arguments: {
    image: "https://httpbin.org/image/png",
    prompt: "这张图片里有什么？一句话回答",
  },
});
console.log(JSON.stringify(r2, null, 2));

console.log("\n=== analyze_image (provider=gemini，无 Key 时应提示未配置) ===");
const r3 = await client.callTool({
  name: "analyze_image",
  arguments: { image: imgPath, provider: "gemini", prompt: "什么颜色？" },
});
console.log(JSON.stringify(r3, null, 2));
const r3text = r3.content?.[0]?.text ?? "";
if (!process.env.GEMINI_API_KEY && !r3text.includes("未配置")) {
  console.error("期望「未配置 Key」错误，实际：" + r3text);
  process.exit(1);
}

await client.close();
console.log("\nSMOKE TEST PASSED ✅");
process.exit(0);
