# 🤖 AI 一键部署指令（AI-DEPLOY）

> 🌐 **语言切换:** [简体中文](AI-DEPLOY.md) · [English](AI-DEPLOY.en.md)

本文件是给 **AI 编程助手**（Codex / Claude Code / Cursor / 通义灵码 / Copilot 等能执行命令的 AI）执行的
**一键部署 SOP**。任何人都可以把这个仓库连同一句话发给 AI，AI 按本文件就能 100% 完成：
**部署 → 逐项询问 → 写配置 → 启动 → 体检 → 客户端接线 → 交付**。

**铁律：每一步都必须有可验证的输出；任何一步 FAIL 必须修复后重跑，全部 PASS 才能交付。禁止跳过任何一步直接宣称成功。**

---

## 使用方法（发给客户 / 同事 / 你自己）

> 请克隆并部署这个仓库：**`https://github.com/nhzhongguo/auto-vision-bridge`**
> 部署前先确认我是否同意部署；我同意后，按仓库根目录 `AI-DEPLOY.md` 的「部署指令」严格执行，
> 过程中需要询问我的配置项（视觉模型、API Key、上游地址、我用的客户端、客户端当前 base_url）都列出来让我选/填，
> 每一步的验证输出都贴给我看。

---

## 铁律（AI 必须遵守）

1. **分层测试，先上游、再 bridge、最后客户端**：先确认上游能通，再确认 bridge 能识图，最后才改客户端配置。
2. **Key 只写进 `bridge/config.json`**（已在 .gitignore）：禁止写进任何会被 git 追踪的文件，禁止贴到聊天里。
3. **`doctor.mjs` 全 PASS 才算部署成功**：FAIL 必须修复后重跑，禁止带病交付。
4. **改任何现有文件前先备份**：`config.json` → `config.json.bak`；`config.toml` → `config.toml.bak-<时间戳>`。
5. **交付前必须让用户自己复测一次**：重启客户端 + 发一张图，用户确认能答对才算完成。

---

## 部署指令

### 第 0 步：环境检查（不满足就装好再继续）

```bash
node -v        # 期望 >= 18（https://nodejs.org）
git --version  # 需要 git
```

AI 记录实际输出；不满足则先安装，重跑本步，拿到满足版本的输出再继续。

### 第 1 步：克隆仓库到稳定目录

```bash
git clone https://github.com/nhzhongguo/auto-vision-bridge.git
cd auto-vision-bridge
git log -1 --oneline   # 确认克隆成功，记录 commit 号
```

- Bridge 模式**零依赖**，不需要 `npm install`（MCP 模式才需要，可选）。
- ⚠️ 告诉用户：**这个文件夹以后不要移动、不要删除**，bridge 的端口和路径一旦变化客户端就连不上。

### 第 2 步：逐项询问用户（AI 不许替用户决定）

1. **视觉模型服务商**
   - 1) 智谱 BigModel `glm-4.6v`（推荐，注册送 600 万 tokens：https://open.bigmodel.cn → API Keys）
   - 2) 硅基流动 `Qwen2.5-VL-7B`（注册送 2000 万 tokens：https://cloud.siliconflow.cn）
   - 3) 自定义 OpenAI 兼容视觉端点
2. **视觉服务的 API Key**（要求用户提供；承诺只存本地 `bridge/config.json`，不进 git、不发给任何人）
3. **上游大模型中转地址**（默认 `http://127.0.0.1:57321`，即用户现在模型请求打到的地址，**不带 `/v1`**）
4. **用户用的 AI 客户端是什么？**
   - Codex 桌面版（Windows 的 `%USERPROFILE%\.codex\config.toml` + cc-switch 模型目录）→ 第 6A 节
   - 其他 OpenAI 兼容客户端（NextChat / Cherry Studio / ChatBox / 自建接口）→ 第 6B 节
   - 不确定 → AI 先自己查（读配置文件、看进程），查不到再问用户
5. **客户端当前 `base_url` 和模型名**：AI 先读配置，读不到再问用户（Codex: `config.toml` 的 `base_url` / `model`；其他客户端：让用户截图设置页）

### 第 3 步：写 bridge 配置（Key 不进 git）

**优先用交互式向导**（用户可自己输 Key，AI 全程看不到 Key）：
```bash
node scripts/setup.mjs
```

AI 代写时（用户已把 Key 给 AI 的情况）：
```bash
# Windows:
Copy-Item bridge/config.example.json bridge/config.json -Force
# macOS / Linux:
cp bridge/config.example.json bridge/config.json
```
已有 `bridge/config.json` 时**先备份**再覆盖（`config.json.bak`）。只改这几个字段：
- `upstream`：用户的中转地址（不带 `/v1`）
- `port`：默认 `57399`（被占用就换端口，**全文档所有 57399 同步替换**）
- `zhipuApiKey`：用户的视觉 Key
- `visionModel` / `visionBaseUrl`：用户选的服务商

写完后必须验证：
1. `Get-Content bridge/config.json`（PowerShell）/ `cat bridge/config.json`：能看到 Key 已写入（输出可打码，如 `d954...tPb9`）
2. `git status`：`bridge/config.json` **不在**变更列表里（.gitignore 已忽略，Key 不会进 git）

### 第 4 步：启动 bridge + 开机自启

```bash
# Windows（隐藏窗口启动，重复执行会自动跳过）
powershell -ExecutionPolicy Bypass -File bridge/start-bridge.ps1
# macOS / Linux
node bridge/server.mjs &
```

启动后**立刻验证**：
```bash
curl http://127.0.0.1:57399/health
# 期望返回 {"ok":true,"service":"vision-bridge",...}
```

开机自启（建议，可选）：
- **Windows（计划任务，隐藏窗口）**：
  ```powershell
  $dir = (Get-Location).Path
  $action = New-ScheduledTaskAction -Execute "powershell" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\bridge\start-bridge.ps1`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  Register-ScheduledTask -TaskName "AutoVisionBridge" -Action $action -Trigger $trigger -Force
  ```
- **Linux（systemd）**：
  ```ini
  [Unit]
  Description=Auto Vision Bridge
  After=network.target
  [Service]
  ExecStart=/usr/bin/node /绝对路径/auto-vision-bridge/bridge/server.mjs
  Restart=always
  [Install]
  WantedBy=multi-user.target
  ```
- 或 pm2：`pm2 start bridge/server.mjs --name vision-bridge && pm2 save && pm2 startup`

### 第 5 步：端到端体检（**强制门槛，FAIL 不许交付**）

```bash
node bridge/doctor.mjs
# 期望输出：全部 PASS，FAIL 0，退出码 0
# 若 bridge 是独立实例（例如从别的目录启动的）：
node bridge/doctor.mjs --config <实例目录>/config.json
```

体检项一览：

| 检查项 | FAIL 的常见原因与修法 |
|---|---|
| Node.js >= 18 | 装 Node，重开终端 |
| config.json 可解析 / Key 已配置 / upstream 已配置 | 重做第 3 步 |
| /health 可达 | bridge 没启动：重跑第 4 步，看启动报错 |
| 带图端到端（识图转文字） | Key 无效（重跑 setup.mjs --test）或上游没这个模型（--model 换上游真实模型名） |
| 无图透传 | 上游挂了：先直测上游（见常见问题 Q4） |
| 客户端 base_url 指向 bridge | **最常犯**：按第 6 步改 config.toml 并重启客户端 |
| 模型目录放行图片输入 | bridge 启动时自动修（日志 [catalog修复]）；没有就重启 bridge |

再跑一次**真实图片**端到端（强烈建议）：
```bash
node bridge/test-bridge.mjs --image <用户的一张真实截图路径> --model <上游真实模型名>
# 期望：第 1 项「自动识别 ✅」、第 3 项「透传 ✅」，最后输出「🎉 全部通过」
```

### 第 6 步：把客户端接到 bridge（**漏了必报错，最核心的一步**）

#### 6A. Codex 桌面版（含 cc-switch）

1. 编辑 `C:\Users\<用户名>\.codex\config.toml`（**先备份** `config.toml.bak-<时间戳>`），把 provider 段的 `base_url` 指向 bridge：
   ```toml
   [model_providers.custom]
   base_url = "http://127.0.0.1:57399/v1"   # 原来是 57321 或官方地址，必须改成 bridge
   ```
   （若用户用的是别的 provider 段名，同样处理，只改 base_url）
2. 确认模型目录已放行图片：bridge 启动时会自动给 `cc-switch-model-catalog.json` 补
   `input_modalities: ["text","image"]`（日志 `[catalog修复]`）。AI 手动确认当前模型已含 `image`；没有就重启 bridge 让它自动修。
3. **重启 Codex 应用**（配置只在会话启动时读取，不重启不生效）。
4. 复测：让用户在新会话里发一张图。

#### 6B. 其他 OpenAI 兼容客户端

1. 模型设置里把 API 地址（base_url）改为 `http://127.0.0.1:57399/v1`，API Key 随便填或填视觉 Key。
2. 模型名填**上游真实模型名**（如 `deepseek-v4-flash`）。
3. 若客户端**连发图按钮都不给点**（前端按模型名硬拦截）→ 见常见问题 Q3（modelAliases 换名方案）。
4. 重启客户端，发图复测。

### 第 7 步：交付清单（逐项打勾）

- [ ] `doctor.mjs` 全部 PASS（把输出贴给用户看）
- [ ] 用户重启客户端后，纯文字对话正常（透传零影响）
- [ ] 用户发图后，收到基于图片内容的正确回答（自动识图生效）
- [ ] 用户知道：① 仓库文件夹别删；② Key 在 `bridge/config.json`；③ 以后报「不支持该能力」先跑 `doctor.mjs`
- [ ] 告知用户「复发时怎么办」（见常见问题 Q1/Q2 的一键修复命令）

---

## 用户不想把 Key 发给 AI？自助配置

```bash
cd auto-vision-bridge
node scripts/setup.mjs        # 交互式：选服务商 → 静默输 Key → 自动备份 → 可选 1x1 验证
node bridge/doctor.mjs        # 体检，全部 PASS 后按第 6 步改客户端 base_url 并重启
```

## 常见问题（AI 排障速查）

### Q1: 发图报「当前模型不支持该能力：vision」（MODEL_CAPABILITY_NOT_SUPPORTED）

- **根因**：客户端的请求**没走 bridge**，直接打到了上游中转/代理，上游按模型能力拦截了带图请求。
  最常见：`base_url` 被切回了 `57321`（cc-switch 切模型等操作会重写 config.toml）。
- **排查**：`node bridge/doctor.mjs` → 第 6 项「客户端接线」FAIL 即此问题。
- **修复**：
  1. 把 `base_url` 改回 `http://127.0.0.1:57399/v1`（见第 6 步，PowerShell 一行版见下方）
  2. 重启客户端
  3. 重跑 `doctor.mjs` 直到第 6 项 PASS
- **一键修复命令（Windows）**：
  ```powershell
  $f = "$env:USERPROFILE\.codex\config.toml"
  (Get-Content $f -Raw) -replace 'http://127\.0\.0\.1:57321(/v1)', 'http://127.0.0.1:57399$1' | Set-Content $f -Encoding UTF8
  ```
- **预防**：切完模型后跑一次 `doctor.mjs`；FAIL 就重改 base_url。

### Q2: 发图后模型答非所问 / 说没看到图

- 图没走到 bridge：`base_url` 没指 `57399`，或 bridge 没在运行。
- 检查：`curl http://127.0.0.1:57399/health` → 然后 `node bridge/doctor.mjs`。

### Q3: 客户端发图按钮都点不了（前端按模型名硬拦截）

- 客户端把模型名换成视觉白名单名（如 `gpt-4o`），并在 `bridge/config.json` 加别名让 bridge 转回真实模型并**强制识图**：
  ```json
  "modelAliases": { "gpt-4o": "deepseek-v4-flash" }
  ```
  重启 bridge 后：客户端配模型 `gpt-4o` 发图 → bridge 收到 `gpt-4o` → 转成 `deepseek-v4-flash` + 强制调视觉模型识图 → 上游正常回答。

### Q4: 上游本身能不能通？（分层定位第一步）

- 直接打上游（把 `<UPSTREAM>` 换成用户的中转地址）：
  ```bash
  curl <UPSTREAM>/v1/models
  ```
- 不通：问题在上游/中转，不在本项目；先让用户修好上游再继续。

### Q5: /health 连不上

- bridge 没启动 / 端口被占 / 目录被移动。手动 `node bridge/server.mjs` 看报错；端口被占用就改 config.json 的 `port` 并同步改客户端 base_url。

### Q6: 视觉识别报 401/403/429

- Key 错 / 服务商限流。重跑 `node scripts/setup.mjs --test` 验证 Key；或换 `glm-4.6v` / 换服务商。

### Q7: 报「模型不可用 / invalid model」

- 上游没有这个模型名。bridge 只负责识图、**不负责换模型**，把客户端模型名改回上游支持的模型。

## 回滚（万一要还原）

1. **配置**：恢复备份——`bridge/config.json.bak` 覆盖回 `bridge/config.json`；`config.toml.bak-*` 覆盖回 `config.toml`。
2. **服务**：停掉 bridge（Windows：任务管理器结束 node.exe；Linux：`kill <PID>` 或 `pm2 stop vision-bridge`）。
3. **客户端**：把 `base_url` 改回原值（备份文件里有），重启客户端即完全还原。
