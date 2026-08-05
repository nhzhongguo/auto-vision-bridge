# 🤖 AI 一键部署指令（AI-DEPLOY）

> 🌐 **语言切换:** [简体中文](AI-DEPLOY.md) · [English](AI-DEPLOY.en.md)

本文件是给 **AI 编程助手**（Codex / Claude Code / Cursor / 通义灵码 / Copilot 等能执行命令的 AI）执行的
**一键部署 SOP**。任何人都可以把这个仓库连同一句话发给 AI，AI 按本文件就能 100% 完成：
**克隆 → 导入技能 → 从内置目录选择视觉模型 → 配置 → 安全体检 → 交付**。

**当前版本：1.2.2（2026-08-05）。**

**铁律：每一步都必须有可验证的输出；任何一步 FAIL 必须修复后重跑，全部 PASS 才能交付。禁止跳过任何一步直接宣称成功。**

---

## 使用方法（发给客户 / 同事 / 你自己）

> 请克隆并部署这个仓库：**`https://github.com/nhzhongguo/auto-vision-bridge`**
> 部署前先确认我是否同意部署；我同意后，按仓库根目录 `AI-DEPLOY.md` 的「部署指令」严格执行，
> 过程中需要询问我的配置项（**视觉模型服务商、API Key**）都列出来让我选/填，
> 每一步的验证输出都贴给我看。

---

## 铁律（AI 必须遵守）

1. **技能模式优先**：默认走「技能一键部署」（`install-skill.mjs`），无需常驻服务、无需改 base_url、无需上游地址。
2. **Key 只写进技能目录 `scripts/config.json`**（已在 .gitignore）：禁止写进任何会被 git 追踪的文件，禁止贴到聊天里。
3. **`doctor.mjs --test` 全 PASS 才算部署成功**：FAIL 必须修复后重跑，禁止带病交付。
4. **改任何现有文件前先备份**：`config.json` → `config.json.bak`。
5. **交付前必须让用户自己复测一次**：在 Codex 里发一张图给不支持视觉的模型，确认能答对才算完成。
6. **明确卸载请求必须立即执行卸载**：用户发送“我要卸载”“卸载视觉”或等价请求时，直接运行 `node scripts/uninstall.mjs --yes`，不要继续测试或输出 API Key。

---

## 部署指令

### 第 0 步：环境检查

```bash
node -v        # 期望 >= 18（https://nodejs.org）
git --version  # 需要 git
```

AI 记录实际输出；不满足则先安装，重跑本步。

### 第 1 步：克隆仓库

```bash
git clone https://github.com/nhzhongguo/auto-vision-bridge.git
cd auto-vision-bridge
git log -1 --oneline   # 确认克隆成功，记录 commit 号
```

- 零依赖，不需要 `npm install`。
- ⚠️ 克隆目录以后不要移动、不要删除（技能会被安装到 `~/.codex/skills/`，但仓库目录用于更新/重装）。

### 第 2 步：一键部署技能（核心步骤）

```bash
node scripts/install-skill.mjs
```

如果用户已经明确指定服务商和视觉模型，AI 可以预选它们，减少交互步骤：

```powershell
node scripts/install-skill.mjs --provider zhipu --model glm-4.6v
```

**这条命令全自动完成：**
1. 技能复制到 `~/.codex/skills/auto-vision-bridge/`，升级时保留已有本地 `scripts/config.json`
2. 交互式选择视觉服务商，并只显示该服务商内置的视觉模型（使用 `--provider`/`--model` 可预选）
3. 显示免费额度/可能计费/价格未知提示；付费或未知价格模型默认不联网测试
4. 静默输入 API Key（不回显，只写本地 `config.json`）
5. 免费档模型才默认用 1×1 测试图验证；其他模型需用户明确确认
6. 运行 `doctor.mjs --test` 端到端体检（付费/未知价格模型默认安全跳过）
7. 输出「下一步」提示

**AI 需要逐项询问用户（服务商和模型由目录辅助选择，Key 仍需用户提供）：**
1. **视觉模型服务商**
   - 1) 智谱 BigModel `glm-4.6v`（推荐，注册送 600 万 tokens：https://open.bigmodel.cn → API Keys）
   - 2) 硅基流动 `Qwen2.5-VL-7B`（注册送 2000 万 tokens：https://cloud.siliconflow.cn）
   - 3) OpenRouter `:free` 模型
   - 4) 自定义 OpenAI 兼容视觉端点
2. **视觉服务的 API Key**（承诺只存本地 `~/.codex/skills/auto-vision-bridge/scripts/config.json`，不进 git、不发给任何人）

> ⚠️ **计费安全**：免费只表示当前目录标注的免费额度/免费档，不保证永久免费；价格未知或可能计费的模型默认不测试。联网验证前必须向用户说明可能扣费。
>
> ⚠️ **不需要再问**：上游中转地址、客户端类型、base_url —— 技能模式完全不需要这些。

> 技能模式最终只需要三项：视觉服务商、确认支持图片的视觉模型、该服务商 API Key。Key 只写入 `~/.codex/skills/auto-vision-bridge/scripts/config.json`，不得回显或提交。

### 第 3 步：验证体检输出

安装脚本会自动跑 `doctor.mjs --test`。如果选择免费档，AI 把完整输出贴给用户看并确认实测成功；如果选择付费或价格未知模型，看到 `WARN ... 已跳过` 是预期的安全行为，不能把它当成失败。

```
PASS Node.js >= 18
PASS config.json 存在
PASS config.json 可解析
PASS 视觉 API Key 已配置
PASS 视觉 API 地址已配置
PASS 视觉模型已配置
PASS 模型看起来支持视觉
PASS 模型计费标记 - 免费额度/免费档（仍可能限流或耗尽额度）
PASS 视觉模型实测可用

体检结果：FAIL 0，PASS 9
```

有任何 FAIL → 告诉用户原因 → 让用户修复（如换 Key、换模型）→ 重跑 `node scripts/doctor.mjs --test`。若是计费风险 WARN，不要为了“全 PASS”强行发请求；只有用户明确同意后才使用 `node scripts/doctor.mjs --test --force`。

### 第 4 步：交付说明（贴给用户）

技能已安装到：`~/.codex/skills/auto-vision-bridge/`

**以后遇到不支持视觉的模型（DeepSeek、Kimi、GLM 文本版等）收到图片时：**
- Codex 会**自动调用技能**把图片识别成文字
- 再用当前模型正常回答
- **无需启动服务、无需改 base_url、无需配置上游地址**

**如需手动测试识图：**
```bash
cd ~/.codex/skills/auto-vision-bridge
node scripts/analyze_image.mjs --image "图片路径" --prompt "你的问题"
```

**配置文件位置（API Key 只存这里，不进 git）：**
```
~/.codex/skills/auto-vision-bridge/scripts/config.json
```

---

## 可选：透明中转模式（bridge 常驻服务）

如果用户**想要**所有请求自动拦截识图（不依赖 Codex 技能机制），可二次配置：

```bash
cd ~/.codex/skills/auto-vision-bridge
node scripts/setup.mjs     # 重新配置，选择"是否启用透明中转模式" → y
node scripts/start-bridge.mjs
# 再把 Codex config.toml 的 base_url 改为 http://127.0.0.1:57399/v1 并重启客户端
```

> 这属于高级用法，普通用户不需要。

---

## 用户不想把 Key 发给 AI？自助部署

```bash
cd auto-vision-bridge
node scripts/install-skill.mjs   # 全程交互，Key 自己输，AI 看不到
```

---

## 常见问题（AI 排障速查）

### Q1: 用户问“我需要改哪个文件？”
- 默认无需手改文件；运行 `node scripts/install-skill.mjs`，按提示输入服务商、视觉模型和 Key 即可。
- 如果必须手动修改，只编辑：`~/.codex/skills/auto-vision-bridge/scripts/config.json`。
- 修改后运行 `node scripts/doctor.mjs --test`，然后重启 Codex。

### Q2: body检 FAIL「视觉 API Key 已配置」
- Key 为空或太短。重跑 `node scripts/setup.mjs` 重新输入。

### Q3: 体检 FAIL「视觉模型实测可用」
| HTTP | 原因 | 修复 |
|------|------|------|
| 401/403 | Key 无效/过期 | 去服务商控制台重新复制 Key |
| 402 | 余额不足 | 充值，或换有免费额度的服务商（智谱/硅基流动） |
| 429 | 限流 | 稍等重试，或换免费档模型 |
| 400 | 模型名错误/不支持图片 | 改用视觉模型：`glm-4.6v`（智谱）或 `Qwen/Qwen2.5-VL-7B-Instruct`（硅基流动） |
| 5xx | 服务商故障 | 稍后重试 |

### Q4: 体检 WARN「模型看起来支持视觉」
- 配置的模型名不像视觉模型（缺少 vl/vision/4v 等标记）。
- 确认模型确实支持图片输入可加 `--force` 跳过，但建议换确认可用的视觉模型。

### Q5: Codex 里发图仍报「不支持视觉」
- 确认 Codex 已重启（技能只在启动时加载）。
- 检查技能目录：`ls ~/.codex/skills/auto-vision-bridge/` 应有 SKILL.md、scripts/ 等。
- 运行 `node scripts/doctor.mjs --test` 确认配置正常。

### Q6: 切换模型后又报「当前模型不支持 vision」
- 确认 Codex `config.toml` 的 `base_url` 仍为 `http://127.0.0.1:57399/v1`，不要直接填 CC Switch 的 `http://127.0.0.1:15721/v1`。
- 确认 Bridge 仍在运行并检查 `http://127.0.0.1:57399/health`。
- CC Switch 切换供应商可能导致当前会话断开；等待 Bridge 自动恢复入口后，重启 Codex 并重新发送图片。

### Q7: 想换视觉服务商 / 换 Key
```bash
cd ~/.codex/skills/auto-vision-bridge
node scripts/setup.mjs   # 重新配置，会自动备份旧 config.json
```

### Q8: 升级技能（拉取仓库新版本）
```bash
cd /path/to/auto-vision-bridge   # 原克隆目录
git pull
node scripts/install-skill.mjs --force   # 强制覆盖安装新版
```


### Q9：用户不想继续使用视觉功能

当用户在当前对话明确发送“我要卸载”“卸载视觉”“关闭视觉功能”等请求时，AI 不要再次进入配置流程，直接执行：

```bash
cd ~/.codex/skills/auto-vision-bridge
node scripts/uninstall.mjs --yes
```

脚本会停止已确认的本地 bridge，备份并还原 Codex `config.toml` 的 `base_url`，再把技能移动到 `~/.codex/skills/auto-vision-bridge-uninstall-backups/`。仓库源代码保留，之后可以重新 `git pull` 和安装。

如果只是预览影响范围，可先运行 `node scripts/uninstall.mjs --dry-run`。

---

## 回滚（万一要还原）

1. **配置**：恢复备份——`config.json.bak` 覆盖回 `config.json`。
2. **技能**：删除技能目录 `~/.codex/skills/auto-vision-bridge/`，重启 Codex 即完全还原。
3. **如开启了 bridge**：停掉 bridge 进程，把 Codex `config.toml` 的 `base_url` 改回原值，重启客户端。

---

## 目录结构说明（给 AI 看的）

```
auto-vision-bridge/              ← 仓库根目录（克隆到这里）
├── scripts/
│   ├── install-skill.mjs        ← 一键部署入口（AI 运行这个）
│   ├── setup.mjs                ← 交互式配置向导
│   ├── doctor.mjs               ← 体检脚本
│   ├── analyze_image.mjs        ← 手动识图工具
│   ├── start-bridge.mjs         ← 启动透明中转（可选）
│   ├── uninstall.mjs             ← 安全一键卸载与还原
│   └── config.example.json      ← 配置模板
├── references/
│   └── providers.md             ← 服务商/模型清单
├── assets/                      ← bridge 资源（可选模式用）
├── agents/                      ← 代理配置示例
├── SKILL.md                     ← Codex 技能定义（核心）
├── .gitignore
├── AI-DEPLOY.md                 ← 本文件
└── README.md
```

技能安装后：
```
~/.codex/skills/auto-vision-bridge/
├── SKILL.md
├── .gitignore
├── scripts/
│   ├── config.json              ← 只有这里存 Key（gitignore）
│   ├── config.example.json
│   ├── setup.mjs / doctor.mjs / analyze_image.mjs / start-bridge.mjs
├── references/
├── assets/
└── agents/
```
