# 🤖 One-Click AI Deployment Instructions (AI-DEPLOY)

> 🌐 **Language:** [简体中文](AI-DEPLOY.md) · [English](AI-DEPLOY.en.md)

Anyone who wants to use this project **doesn't need to read the code** — just send the following message together with the repository URL to any AI coding assistant
(Codex / Claude Code / Cursor / Tongyi Lingma / Copilot, or any AI that can run commands),
and the AI will automatically handle the whole flow: **deploy → ask about the vision model → collect API Key → write config → start → verify → hand off**.

---

## How to use (send this to a customer / colleague / yourself)

> Please clone and deploy this repository: **`https://github.com/nhzhongguo/auto-vision-bridge`**
> Before deploying, confirm whether I agree to the deployment; once I agree, follow the "Deployment Instructions" in the `AI-DEPLOY.en.md` file at the repository root,
> and list all the configuration items you need to ask me about (vision model, API Key, upstream address) one by one for me to choose/fill in.

---

## Deployment Instructions (the AI follows this flow)

### Step 0: Environment check
- Confirm Node.js ≥ 18 is installed (`node -v`); if not, install it first: https://nodejs.org

### Step 1: Clone & install
```bash
git clone https://github.com/nhzhongguo/auto-vision-bridge.git
cd auto-vision-bridge
npm install          # only needed for MCP mode; Bridge mode is zero-dependency and can be skipped
npm run build        # compile for MCP mode (optional; not needed for Bridge mode)
```

### Step 2: Ask the user (ask every item one by one — don't decide for them)
Ask the user the following questions and wait for answers:

1. **Which vision model provider do you want to use?**
   - 1) Zhipu BigModel `glm-4.6v` (recommended; registration includes 6M free tokens: https://open.bigmodel.cn → API Keys)
   - 2) SiliconFlow `Qwen2.5-VL-7B` (registration includes 20M free tokens: https://cloud.siliconflow.cn)
   - 3) Custom OpenAI-compatible endpoint
2. **What is the API Key for the vision service?** (ask the user to provide it; tell them it will never be committed to git — it is only stored in the local config.json)
3. **What is the upstream LLM relay address?** (default `http://127.0.0.1:57321` — the model API address the user is currently using, without `/v1`)

### Step 3: Write the config (Key never goes into git)
- Copy `bridge/config.example.json` → `bridge/config.json`
- Fill in the user's chosen `visionBaseUrl`, `visionModel`, `zhipuApiKey`, `upstream`
- If `bridge/config.json` already exists, back it up as `config.json.bak` first, then overwrite
- **Never write the Key into any file tracked by git** (config.json is already in .gitignore)

### Step 4: Start the service
```bash
# Windows
powershell -ExecutionPolicy Bypass -File bridge/start-bridge.ps1
# macOS / Linux
node bridge/server.mjs
```
- Recommended: register for auto-start on boot (Windows Task Scheduler `Register-ScheduledTask` / Linux `systemd` or `pm2`)

### Step 5: Verify
```bash
# 1. Health check
curl http://127.0.0.1:57399/health
# 2. End-to-end test (really calls the vision model + upstream model to confirm the image is recognized)
node bridge/test-bridge.mjs --image <any image path>
```
- Health check returns `"ok": true`, and the test request returns the upstream model's correct answer about the image → passed

### Step 6: Hand-off notes (tell the user)
1. Open your AI client's model config and change `base_url` to `http://127.0.0.1:57399/v1`
2. Restart the AI client
3. From now on, just send images: **if the model doesn't support vision → the vision model is called automatically and the image is converted to text; if it supports vision → the image passes through untouched**. No manual steps needed
4. If the user doesn't want you (the AI) to touch the Key: let them run `node scripts/setup.mjs` themselves for interactive config, then restart — done

---

## User doesn't want to hand the Key to the AI? Self-service config

```bash
cd auto-vision-bridge
node scripts/setup.mjs
# Follow the prompts: choose vision provider → paste Key (silent input, no echo) → config written automatically → optional Key verification
# Then start + change base_url + restart the client, see the tips at the end of the wizard
```

## Common deployment issues

| Symptom | Cause & fix |
|---|---|
| `curl /health` can't connect | Bridge not running: check whether `node bridge/server.mjs` is running and whether the port is occupied |
| Model gives irrelevant answers after sending an image | The image isn't reaching the bridge: confirm the client's `base_url` points to `http://127.0.0.1:57399/v1` |
| "Model unavailable" error | The upstream relay doesn't have this model; switch back to a model name the upstream supports (the bridge only handles image recognition, it doesn't switch models) |
| Vision recognition returns 401/403 | Wrong API Key or provider restriction; re-run `node scripts/setup.mjs` to reconfigure |
| Recognition returns 429 | Free tier rate-limited; switch to `glm-4.6v` / switch provider |
