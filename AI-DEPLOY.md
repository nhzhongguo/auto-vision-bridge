# 🤖 AI 一键部署指令（AI-DEPLOY）

任何人想用这个项目时，**不需要自己读代码**——把下面这段话连仓库地址一起发给任意 AI 编程助手
（Codex / Claude Code / Cursor / 通义灵码 / Copilot 等支持执行命令的 AI），
AI 就会自动完成：**部署 → 询问视觉模型 → 收集 API Key → 写配置 → 启动 → 验证 → 交付**。

---

## 使用方法（发给客户 / 同事 / 你自己）

> 请克隆并部署这个仓库：**`https://github.com/nhzhongguo/auto-vision-bridge`**
> 部署前先确认我是否同意部署；我同意后，按仓库根目录 `AI-DEPLOY.md` 的「部署指令」执行，
> 过程中需要询问我的配置项（视觉模型、API Key、上游地址）都列出来让我选/填。

---

## 部署指令（AI 执行时遵循以下流程）

### 第 0 步：环境检查
- 确认已安装 Node.js ≥ 18（`node -v`），没有则先安装：https://nodejs.org

### 第 1 步：克隆与安装
```bash
git clone https://github.com/nhzhongguo/auto-vision-bridge.git
cd auto-vision-bridge
npm install          # 仅 MCP 模式需要；Bridge 模式零依赖，可跳过
npm run build        # 编译 MCP 模式（可选；Bridge 模式不需要）
```

### 第 2 步：询问用户（必须逐项询问，不要替用户决定）
向用户依次提问并等待回答：

1. **要使用哪个视觉模型服务商？**
   - 1) 智谱 BigModel `glm-4.6v`（推荐，注册送 600 万 tokens：https://open.bigmodel.cn → API Keys）
   - 2) 硅基流动 `Qwen2.5-VL-7B`（注册送 2000 万 tokens：https://cloud.siliconflow.cn）
   - 3) 自定义 OpenAI 兼容端点
2. **视觉服务的 API Key？**（要求用户提供；告知不会写入 git、只保存在本地 config.json）
3. **上游大模型中转地址？**（默认 `http://127.0.0.1:57321`，即用户正在用的模型 API 地址，不带 `/v1`）

### 第 3 步：写配置（Key 不进 git）
- 复制 `bridge/config.example.json` → `bridge/config.json`
- 填入用户选择的 `visionBaseUrl`、`visionModel`、`zhipuApiKey`、`upstream`
- 若已有 `bridge/config.json`，先备份为 `config.json.bak` 再覆盖
- **严禁把 Key 写入任何会被 git 追踪的文件**（config.json 已在 .gitignore 中）

### 第 4 步：启动服务
```bash
# Windows
powershell -ExecutionPolicy Bypass -File bridge/start-bridge.ps1
# macOS / Linux
node bridge/server.mjs
```
- 建议注册开机自启（Windows 计划任务 `Register-ScheduledTask` / Linux `systemd` 或 `pm2`）

### 第 5 步：验证
```bash
# 1. 健康检查
curl http://127.0.0.1:57399/health
# 2. 端到端测试（真实调用视觉模型 + 上游模型，验证图片被正确识别）
node bridge/test-bridge.mjs --image <任意图片路径>
```
- 健康检查返回 `"ok": true`、测试请求返回上游模型对图片的正确回答 → 通过

### 第 6 步：交付说明（告诉用户）
1. 打开 AI 客户端的模型配置，把 `base_url` 改为 `http://127.0.0.1:57399/v1`
2. 重启 AI 客户端
3. 以后直接发图即可：**模型不支持视觉 → 自动调视觉模型转成文字；模型支持视觉 → 原样透传**，无需任何手动操作
4. 若用户不想让你（AI）碰 Key：让他自己跑 `node scripts/setup.mjs` 交互式配置，改完重启即可

---

## 用户不想把 Key 发给 AI？自助配置

```bash
cd auto-vision-bridge
node scripts/setup.mjs
# 按提示选择视觉服务商 → 粘贴 Key（静默输入，不回显）→ 自动写入配置 → 可选验证 Key
# 然后启动 + 改 base_url + 重启客户端，见向导最后的提示
```

## 常见部署问题

| 现象 | 原因与解决 |
|---|---|
| `curl /health` 连不上 | bridge 没启动：检查 `node bridge/server.mjs` 是否在跑、端口是否被占用 |
| 发图后模型答非所问 | 图片没走到 bridge：确认客户端 `base_url` 已指向 `http://127.0.0.1:57399/v1` |
| 报「模型不可用」 | 上游中转没有这个模型，换回上游支持的模型名即可（bridge 只负责识图，不换模型） |
| 视觉识别报 401/403 | API Key 错误或服务商限制，重新 `node scripts/setup.mjs` 配置 |
| 识别报 429 | 免费档限流，换 `glm-4.6v` / 换服务商 |
