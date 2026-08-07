---
name: auto-vision-bridge
description: 让不支持视觉的模型也能看图。当用户发送图片、截图、照片，或要求描述、OCR、读取图片内容，而当前模型不支持视觉、报「当前模型不支持该能力：vision」或「此模型不支持图片输入」时，使用本技能调用外部视觉大模型把图片转成文字，再继续回答。也用于配置或修复本地 vision bridge 中转层，让发图请求被自动拦截并转文字。
---

# Auto Vision Bridge

## 🚀 一键部署（推荐）

克隆仓库后，直接运行：

```bash
node scripts/install-skill.mjs
```

全自动完成：**导入技能 → 选视觉服务商 → 选择已登记的视觉模型 → 输 Key → 安全验证 → 体检 → 交付**。
通常只需两项配置：**视觉模型服务商**、**API Key**。本地 Ollama 模式不需要 API Key。向导会内置该服务商的视觉模型目录，不会拿纯文本模型反复试错。
无需上游地址、无需启动服务、无需改 base_url。

---

## 核心流程：直接识图（首选）

技能安装后，当 Codex 检测到当前模型不支持视觉时，会**自动调用** `scripts/analyze_image.mjs` 把图片识别成文字，再用当前模型正常回答。

手动测试识图：
```powershell
node scripts/analyze_image.mjs --image "C:\Users\...\截图.png" --prompt "这张图里写了什么？回答用户的问题"
```

## 配置

脚本默认读取技能目录下 `scripts/config.json`。也可用环境变量或命令行覆盖，优先级：命令行 > 环境变量 > config.json。

- 环境变量：`VISION_API_KEY`、`VISION_BASE_URL`、`VISION_MODEL` 可免配置文件运行
- 命令行：`--api-key`、`--base-url`、`--model`、`--config`、`--prompt`、`--max-chars`、`--json`
- config.json 字段见 `scripts/config.example.json`

API Key 只放在 `scripts/config.json`（已 gitignore），不要把它写进 SKILL.md、脚本或任何会提交的文件。

首次配置运行：
```bash
node scripts/setup.mjs   # 交互式：选服务商/视觉模型 → 静默输 Key → 按计费风险验证
node scripts/doctor.mjs --test   # 免费档自动验证；付费/未知价格默认跳过
```

### 本地开源视觉模型

不想使用外部视觉 API 时，可用 Ollama 在本机运行开源模型：

```powershell
node scripts/install-local-model.mjs
node scripts/setup.mjs   # 选择“本地 Ollama 开源视觉模型”，无需输入 Key
```

默认模型是 `moondream`，本地服务地址是 `http://127.0.0.1:11434`。模型权重由 Ollama 管理，不会写入本技能仓库。


### 视觉模型目录与计费安全

- 向导只展示内置目录中明确标记 `vision: true` 的模型；纯文本模型不会被拿来试错。
- `免费额度/免费档` 不是“永久免费”：仍可能限流、耗尽赠送额度，最终以服务商控制台规则为准。
- `可能产生费用` 或 `价格未知` 的模型，向导默认不发送联网测试；只有用户明确确认承担费用后才测试。
- 自定义模型如果无法确认支持图片，会保存配置但跳过自动验证。
- `doctor.mjs --test` 同样默认跳过付费/未知价格模型；确认费用后可显式使用 `--force`。

## 可选：透明中转模式

如果希望客户端每次发图都自动经过识图（用户不改任何操作），可启动本地 bridge：

1. `node scripts/doctor.mjs` 检查配置与依赖
2. `node scripts/setup.mjs` 重新配置，选择"启用透明中转模式"
3. `node scripts/start-bridge.mjs` 启动 57399 端口
4. 把 Codex `config.toml` 的 `base_url` 改为 `http://127.0.0.1:57399/v1`，重启客户端

bridge 是常驻进程，重启电脑后需重新启动，用 `doctor.mjs` 可一键检查。若当前模型仍报「当前模型不支持该能力：vision」而 bridge 已运行，说明请求没走到 bridge，先检查 `base_url` 和 `/health`。

## 一键卸载视觉功能

当用户明确发送“我要卸载”“卸载视觉”“关闭视觉功能”或等价请求时，**停止当前配置流程，不要继续测试模型，也不要索要或输出 API Key**，直接执行：

```powershell
node scripts/uninstall.mjs --yes
```

卸载脚本会：

- 停止已确认属于 Auto Vision Bridge 的本地 bridge；
- 如果 Codex `config.toml` 的 `base_url` 指向 bridge，先备份再还原到原上游地址；
- 将已安装技能移动到 `~/.codex/skills/auto-vision-bridge-uninstall-backups/`，而不是永久删除；
- 保留仓库源代码，方便用户以后重新拉取或运行安装脚本。

如果用户只是询问如何卸载，先说明上述命令；如果用户已经明确要求卸载，则无需再次确认，执行 `--yes` 并把命令输出如实反馈。

## 升级技能

```bash
cd /path/to/auto-vision-bridge   # 原克隆目录
git pull
node scripts/install-skill.mjs --force   # 强制覆盖安装新版
```

## 故障排查

- `401/403`：API Key 错误或服务商拒绝，重新运行 `node scripts/setup.mjs`
- `402`：视觉服务账号余额不足（硅基流动常见），换智谱或充值
- `429`：免费档限流，稍后重试或换服务商
- 网络错误或超时：检查 `VISION_BASE_URL` 是否可达；智谱默认 `https://open.bigmodel.cn/api/paas/v4/chat/completions`
- 返回空内容：换 `glm-4.6v`（智谱）或 `Qwen/Qwen2.5-VL-7B-Instruct`（硅基流动）等确认可用的视觉模型
- 文件找不到：确认图片路径存在，Windows 路径建议用绝对路径
- Codex 仍报「不支持视觉」：重启 Codex（技能仅启动时加载），跑 `node scripts/doctor.mjs --test` 确认配置正常

服务商清单见 `references/providers.md`。
