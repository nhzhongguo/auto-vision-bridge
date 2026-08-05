# 🤖 One-Click AI Deployment Instructions (AI-DEPLOY)

> 🌐 **Language:** [简体中文](AI-DEPLOY.md) · [English](AI-DEPLOY.en.md)

This file is a **one-click deployment SOP** for an **AI coding assistant** (Codex / Claude Code / Cursor / Tongyi Lingma / Copilot, or any AI that can run commands). Anyone can send this repository together with a single sentence to an AI, and the AI follows this file to complete the whole flow with 100% reliability:
**clone → import skill → configure vision model → health check → hand off**.

**Current version: 1.2.2 (2026-08-05).**

**Iron rule: every step must produce verifiable output; if any step FAILs, fix it and re-run — you may hand off only when everything PASSes. Skipping steps and claiming success is forbidden.**

---

## How to use (send this to a customer / colleague / yourself)

> Please clone and deploy this repository: **`https://github.com/nhzhongguo/auto-vision-bridge`**
> Before deploying, confirm whether I agree to the deployment; once I agree, strictly follow the "Deployment Instructions" in the root `AI-DEPLOY.md`,
> list every config item you need to ask me about (**vision model provider, API Key**) for me to choose/fill in,
> and paste every step'\''s verification output back to me.

---

## Iron rules (the AI must obey)

1. **Skill mode first**: default to "skill one-click deployment" (`install-skill.mjs`), no resident service, no base_url change, no upstream address needed.
2. **The Key is written only into the skill directory `scripts/config.json`** (already in .gitignore): never write it into any git-tracked file, never paste it into the chat.
3. **`doctor.mjs --test` must PASS everything before the deployment counts as successful**: fix any FAIL and re-run; never hand off with known failures.
4. **Back up any existing file before modifying it**: `config.json` → `config.json.bak`.
5. **Before hand-off, the user must re-test themselves**: in Codex, send an image to a non-vision model, confirm it answers correctly.
6. **An explicit uninstall request must run uninstall immediately**: if the user sends “I want to uninstall”, “uninstall vision”, or an equivalent request, run `node scripts/uninstall.mjs --yes`; do not continue testing or print the API Key.

---

## Deployment Instructions

### Step 0: Environment check

```bash
node -v        # expect >= 18 (https://nodejs.org)
git --version  # git required
```

Record the actual output. If not satisfied, install first, then re-run this step.

### Step 1: Clone the repository

```bash
git clone https://github.com/nhzhongguo/auto-vision-bridge.git
cd auto-vision-bridge
git log -1 --oneline   # confirm the clone succeeded, record the commit hash
```

- Zero dependencies, no `npm install` needed.
- ⚠️ Do not move or delete this folder later (the skill is installed to `~/.codex/skills/`, but the repo folder is used for updates/reinstalls).

### Step 2: One-click skill deployment (core step)

```bash
node scripts/install-skill.mjs
```

If the user already named the provider and vision model, preselect them to reduce the interaction:

```powershell
node scripts/install-skill.mjs --provider zhipu --model glm-4.6v
```

**This command fully automates:**
1. Copies the skill to `~/.codex/skills/auto-vision-bridge/`, preserving the existing local `scripts/config.json` during upgrades
2. Interactive provider selection, showing only models marked as vision-capable in the built-in catalog (or use `--provider`/`--model` to preselect)
3. Shows free-tier / possibly-billed / unknown-price warnings; paid or unknown models are not tested by default
4. Silent API Key input (no echo, only written to local `config.json`)
5. Uses a 1×1 test image by default only for free-tier models; other models require explicit confirmation
6. Runs `doctor.mjs --test` end-to-end health check (paid/unknown models are safely skipped by default)
7. Outputs "next steps" guidance

**AI should use the catalog to help choose the provider/model, and ask the user for the API Key:**
1. **Vision model provider**
   - 1) Zhipu BigModel `glm-4.6v` (recommended, 6M free tokens on signup: https://open.bigmodel.cn → API Keys)
   - 2) SiliconFlow `Qwen2.5-VL-7B` (20M free tokens on signup: https://cloud.siliconflow.cn)
   - 3) OpenRouter `:free` models
   - 4) Custom OpenAI-compatible vision endpoint
2. **Vision service API Key** (promise: stored only in local `~/.codex/skills/auto-vision-bridge/scripts/config.json`, never in git, never sent to anyone)

> ⚠️ **Billing safety**: “free” means only the current catalog marks a free tier/quota; it is not a promise of permanent free usage. Paid or unknown-price models are skipped by default. Warn the user about possible charges before any live test.
>
> ⚠️ **No need to ask**: upstream relay address, client type, base_url — skill mode does not need these at all.

> Skill mode ultimately needs only three items: vision provider, a confirmed vision-capable model, and that provider API Key. The Key is written only to `~/.codex/skills/auto-vision-bridge/scripts/config.json`; never echo or commit it.

### Step 3: Verify health check output

The install script auto-runs `doctor.mjs --test`. For a free-tier model, paste the full output and confirm the live test succeeded. For a paid or unknown-price model, `WARN ... skipped` is expected safe behavior and must not be “fixed” by sending a request.

```
PASS Node.js >= 18
PASS config.json exists
PASS config.json parseable
PASS Vision API Key configured
PASS Vision API URL configured
PASS Vision model configured
PASS Model looks like a vision model
PASS Model billing marker - free tier/quota (may still be rate-limited or exhausted)
PASS Vision model live test OK

Health check result: FAIL 0, PASS 9
```

Any FAIL → tell user the reason → user fixes (e.g. change Key, change model) → re-run `node scripts/doctor.mjs --test` until all PASS.

### Step 4: Hand-off guidance (paste to user)

Skill installed to: `~/.codex/skills/auto-vision-bridge/`

**When a non-vision model (DeepSeek, Kimi, GLM text-only, etc.) receives an image:**
- Codex **automatically invokes the skill** to recognize the image to text
- Then the current model answers normally
- **No service to start, no base_url to change, no upstream to configure**

**Manual test recognition:**
```bash
cd ~/.codex/skills/auto-vision-bridge
node scripts/analyze_image.mjs --image "image path" --prompt "your question"
```

**Config file location (API Key only here, not in git):**
```
~/.codex/skills/auto-vision-bridge/scripts/config.json
```

---

## Optional: Transparent Proxy Mode (bridge resident service)

If the user **wants** all requests auto-intercepted for recognition (not relying on Codex skill mechanism), they can configure twice:

```bash
cd ~/.codex/skills/auto-vision-bridge
node scripts/setup.mjs     # re-configure, choose "enable transparent proxy mode" → y
node scripts/start-bridge.mjs
# then change Codex config.toml base_url to http://127.0.0.1:57399/v1 and restart client
```

> Advanced usage, most users do not need this.

**Codex + CC Switch routing rules (mandatory):**

- Codex `base_url` must be `http://127.0.0.1:57399/v1`.
- Put the CC Switch address (usually `http://127.0.0.1:15721`) in the Bridge `upstream` setting.
- Do not point Codex directly at `15721`: CC Switch can return `MODEL_CAPABILITY_NOT_SUPPORTED` before the image reaches the Bridge.
- The Bridge watches Codex `config.toml` and restores `57399` if a CC Switch provider switch overwrites `base_url`. Switching providers may restart routing and disconnect the current chat; wait for the repair and retry, restarting Codex if needed.
- The Bridge converts images to text for the upstream model; it cannot turn an upstream text-only model into a native multimodal model.

---

## User doesn'\''t want to give Key to AI? Self-service deployment

```bash
cd auto-vision-bridge
node scripts/install-skill.mjs   # fully interactive, user types Key, AI never sees it
```

---

## Troubleshooting (AI quick reference)

### Q1: The user asks “which file should I edit?”
- Normally none; run `node scripts/install-skill.mjs` and enter the provider, vision model, and Key.
- If manual editing is required, edit only `~/.codex/skills/auto-vision-bridge/scripts/config.json`.
- Run `node scripts/doctor.mjs --test` after editing, then restart Codex.

### Q2: Health check FAIL "Vision API Key configured"
- Key empty or too short. Re-run `node scripts/setup.mjs` to re-enter.

### Q3: Health check FAIL "Vision model live test OK"
| HTTP | Cause | Fix |
|------|-------|-----|
| 401/403 | Key invalid/expired | Re-copy Key from provider console |
| 402 | Insufficient balance | Top up, or switch to provider with free tier (Zhipu/SiliconFlow) |
| 429 | Rate limited | Wait and retry, or switch free-tier model/provider |
| 400 | Wrong model name / model does not support images | Use a vision model: `glm-4.6v` (Zhipu) or `Qwen/Qwen2.5-VL-7B-Instruct` (SiliconFlow) |
| 5xx | Provider outage | Retry later |

### Q4: Health check WARN "Model looks like a vision model"
- Configured model name does not look like a vision model (missing vl/vision/4v markers).
- If confirmed the model does support images, can use `--force` to skip, but recommended to switch to a confirmed vision model.

### Q5: Codex still reports "vision not supported" when sending image
- Confirm Codex has been restarted (skill loads only on startup).
- Check skill directory: `ls ~/.codex/skills/auto-vision-bridge/` should have SKILL.md, scripts/, etc.
- Run `node scripts/doctor.mjs --test` to verify config.

### Q6: After switching models Codex still says “vision is not supported”
- Confirm Codex `config.toml` still uses `http://127.0.0.1:57399/v1`; do not use CC Switch's direct `http://127.0.0.1:15721/v1`.
- Confirm the Bridge is running with `http://127.0.0.1:57399/health`.
- A CC Switch provider switch may disconnect the current chat; wait for the Bridge to restore the entry point, restart Codex, and send the image again.

### Q7: Want to change vision provider / change Key
```bash
cd ~/.codex/skills/auto-vision-bridge
node scripts/setup.mjs   # re-configure, auto-backups old config.json
```

### Q8: Upgrade skill (pull new version from repo)
```bash
cd /path/to/auto-vision-bridge   # original clone folder
git pull
node scripts/install-skill.mjs --force   # force overwrite with new version
```


### Q9: The user no longer wants vision support

When the user explicitly sends “I want to uninstall”, “uninstall vision”, “turn off vision”, or an equivalent request in the current chat, do not restart configuration. Run:

```bash
cd ~/.codex/skills/auto-vision-bridge
node scripts/uninstall.mjs --yes
```

The script stops only a confirmed local bridge, backs up and restores the Codex `config.toml` `base_url`, then moves the installed skill to `~/.codex/skills/auto-vision-bridge-uninstall-backups/`. The repository source remains available for a later `git pull` and reinstall.

To preview the impact without changes, use `node scripts/uninstall.mjs --dry-run`.

---

## Rollback (just in case)

1. **Config**: restore backup — `config.json.bak` back over `config.json`.
2. **Skill**: delete skill directory `~/.codex/skills/auto-vision-bridge/`, restart Codex — fully restored.
3. **If bridge was enabled**: stop bridge process, change Codex `config.toml` `base_url` back to original, restart client.

---

## Directory structure (for AI reference)

```
auto-vision-bridge/              ← repo root (cloned here)
├── scripts/
│   ├── install-skill.mjs        ← one-click deploy entry (AI runs this)
│   ├── setup.mjs                ← interactive config wizard
│   ├── doctor.mjs               ← health check script
│   ├── analyze_image.mjs        ← manual recognition tool
│   ├── start-bridge.mjs         ← start transparent proxy (optional)
│   ├── uninstall.mjs             ← safe one-click uninstall and restore
│   └── config.example.json      ← config template
├── references/
│   └── providers.md             ← provider/model list
├── assets/                      ← bridge assets (optional mode)
├── agents/                      ← agent config examples
├── SKILL.md                     ← Codex skill definition (core)
├── .gitignore
├── AI-DEPLOY.md                 ← this file (Chinese)
├── AI-DEPLOY.en.md              ← this file (English)
└── README.md
```

After skill install:
```
~/.codex/skills/auto-vision-bridge/
├── SKILL.md
├── .gitignore
├── scripts/
│   ├── config.json              ← only here stores Key (gitignored)
│   ├── config.example.json
│   ├── setup.mjs / doctor.mjs / analyze_image.mjs / start-bridge.mjs
├── references/
├── assets/
└── agents/
```
