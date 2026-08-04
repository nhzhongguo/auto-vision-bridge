# 🤖 One-Click AI Deployment Instructions (AI-DEPLOY)

> 🌐 **Language:** [简体中文](AI-DEPLOY.md) · [English](AI-DEPLOY.en.md)

This file is a **one-click deployment SOP** for an **AI coding assistant** (Codex / Claude Code / Cursor / Tongyi Lingma / Copilot, or any AI that can run commands). Anyone can send this repository together with a single sentence to an AI, and the AI follows this file to complete the whole flow with 100% reliability:
**deploy → ask every config item → write config → start → health check → connect the client → hand off**.

**Iron rule: every step must produce verifiable output; if any step FAILs, fix it and re-run — you may hand off only when everything PASSes. Skipping steps and claiming success is forbidden.**

---

## How to use (send this to a customer / colleague / yourself)

> Please clone and deploy this repository: **`https://github.com/nhzhongguo/auto-vision-bridge`**
> Before deploying, confirm whether I agree to the deployment; once I agree, strictly follow the "Deployment Instructions" in the root `AI-DEPLOY.md`,
> list every config item you need to ask me about (vision model, API Key, upstream address, the client I use, the client's current base_url) for me to choose/fill in,
> and paste every step's verification output back to me.

---

## Iron rules (the AI must obey)

1. **Layered testing — upstream first, then bridge, then client**: first confirm the upstream works, then confirm the bridge can recognize images, and only then modify the client config.
2. **The Key is written only into `bridge/config.json`** (already in .gitignore): never write it into any git-tracked file, never paste it into the chat.
3. **`doctor.mjs` must PASS everything before the deployment counts as successful**: fix any FAIL and re-run; never hand off with known failures.
4. **Back up any existing file before modifying it**: `config.json` → `config.json.bak`; `config.toml` → `config.toml.bak-<timestamp>`.
5. **Before hand-off, the user must re-test themselves**: restart the client + send an image; done only when the user confirms the answer is correct.

---

## Deployment Instructions

### Step 0: Environment check (install first if requirements are not met)

```bash
node -v        # expect >= 18 (https://nodejs.org)
git --version  # git required
```

Record the actual output. If not satisfied, install first, then re-run this step and continue only with a satisfying version output.

### Step 1: Clone the repository to a stable directory

```bash
git clone https://github.com/nhzhongguo/auto-vision-bridge.git
cd auto-vision-bridge
git log -1 --oneline   # confirm the clone succeeded, record the commit hash
```

- Bridge mode is **zero-dependency** — no `npm install` needed (only MCP mode needs it, optional).
- ⚠️ Tell the user: **do not move or delete this folder later** — if the bridge port or path changes, the client will no longer be able to connect.

### Step 2: Ask the user item by item (the AI must not decide for the user)

1. **Vision model provider**
   - 1) Zhipu BigModel `glm-4.6v` (recommended; registration includes 6M free tokens: https://open.bigmodel.cn → API Keys)
   - 2) SiliconFlow `Qwen2.5-VL-7B` (registration includes 20M free tokens: https://cloud.siliconflow.cn)
   - 3) Custom OpenAI-compatible vision endpoint
2. **API Key for the vision service** (ask the user to provide it; promise it is stored only in the local `bridge/config.json`, never in git, never sent to anyone)
3. **Upstream LLM relay address** (default `http://127.0.0.1:57321`, i.e. the address the user's model requests currently go to, **without `/v1`**)
4. **Which AI client does the user use?**
   - Codex desktop (Windows `%USERPROFILE%\.codex\config.toml` + cc-switch model catalog) → go to section 6A
   - Other OpenAI-compatible clients (NextChat / Cherry Studio / ChatBox / self-hosted endpoint) → go to section 6B
   - Not sure → the AI first investigates on its own (read config files, inspect processes); only ask the user if nothing can be found
5. **The client's current `base_url` and model name**: the AI reads the config first; only ask the user if it cannot be found (Codex: `base_url` / `model` in `config.toml`; other clients: ask the user to screenshot the settings page)

### Step 3: Write the bridge config (Key never enters git)

**Prefer the interactive wizard** (the user can type the Key themselves and the AI never sees it):
```bash
node scripts/setup.mjs
```

When the AI writes it for the user (the user already gave the Key to the AI):
```bash
# Windows:
Copy-Item bridge/config.example.json bridge/config.json -Force
# macOS / Linux:
cp bridge/config.example.json bridge/config.json
```
If `bridge/config.json` already exists, **back it up first** (`config.json.bak`) before overwriting. Only touch these fields:
- `upstream`: the user's relay address (without `/v1`)
- `port`: default `57399` (if occupied, change it and **replace every `57399` in this whole document**)
- `zhipuApiKey`: the user's vision Key
- `visionModel` / `visionBaseUrl`: the provider the user chose

After writing, verify:
1. `Get-Content bridge/config.json` (PowerShell) / `cat bridge/config.json`: the Key is present (masking the output is fine, e.g. `d954...tPb9`)
2. `git status`: `bridge/config.json` is **not** in the changed list (it is ignored by .gitignore, so the Key never enters git)

### Step 4: Start the bridge + auto-start on boot

```bash
# Windows (hidden window; repeated runs are skipped automatically)
powershell -ExecutionPolicy Bypass -File bridge/start-bridge.ps1
# macOS / Linux
node bridge/server.mjs &
```

Verify **immediately** after starting:
```bash
curl http://127.0.0.1:57399/health
# expect {"ok":true,"service":"vision-bridge",...}
```

Auto-start on boot (recommended, optional):
- **Windows (Task Scheduler, hidden window)**:
  ```powershell
  $dir = (Get-Location).Path
  $action = New-ScheduledTaskAction -Execute "powershell" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\bridge\start-bridge.ps1`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  Register-ScheduledTask -TaskName "AutoVisionBridge" -Action $action -Trigger $trigger -Force
  ```
- **Linux (systemd)**:
  ```ini
  [Unit]
  Description=Auto Vision Bridge
  After=network.target
  [Service]
  ExecStart=/usr/bin/node /absolute/path/auto-vision-bridge/bridge/server.mjs
  Restart=always
  [Install]
  WantedBy=multi-user.target
  ```
- or pm2: `pm2 start bridge/server.mjs --name vision-bridge && pm2 save && pm2 startup`

### Step 5: End-to-end health check (**mandatory gate — no hand-off on FAIL**)

```bash
node bridge/doctor.mjs
# expect: all PASS, FAIL 0, exit code 0
# if the bridge is a separate instance (e.g. started from another directory):
node bridge/doctor.mjs --config <instance-dir>/config.json
```

Checks:

| Check | Common FAIL cause & fix |
|---|---|
| Node.js >= 18 | Install Node, reopen the terminal |
| config.json parses / Key configured / upstream configured | Redo Step 3 |
| /health reachable | Bridge not running: redo Step 4, read the startup error |
| Image end-to-end (recognize → text) | Key invalid (re-run setup.mjs --test) or upstream lacks this model (--model with a real upstream model name) |
| No-image passthrough | Upstream is down: test the upstream directly first (see FAQ Q4) |
| Client base_url points to the bridge | **Most common mistake**: change config.toml per Step 6 and restart the client |
| Model catalog allows image input | The bridge fixes it automatically at startup (log [catalog修复]); if not, restart the bridge |

Then run one more **real-image** end-to-end test (strongly recommended):
```bash
node bridge/test-bridge.mjs --image <a real screenshot path from the user> --model <real upstream model name>
# expect: item 1 "自动识别 ✅", item 3 "透传 ✅", final output "🎉 全部通过"
```

### Step 6: Connect the client to the bridge (**skipping this will fail — the most critical step**)

#### 6A. Codex desktop (including cc-switch)

1. Edit `C:\Users\<username>\.codex\config.toml` (**back it up first** `config.toml.bak-<timestamp>`), point the provider section's `base_url` at the bridge:
   ```toml
   [model_providers.custom]
   base_url = "http://127.0.0.1:57399/v1"   # was 57321 or the official address — must be changed to the bridge
   ```
   (If the user uses a different provider section name, handle it the same way — only change base_url)
2. Confirm the model catalog allows images: at startup the bridge automatically adds
   `input_modalities: ["text","image"]` to `cc-switch-model-catalog.json` (log [catalog修复]). The AI checks manually that the current model includes `image`; if not, restart the bridge so it auto-fixes.
3. **Restart the Codex app** (config is only read at session start; restarting is required).
4. Re-test: have the user send an image in a new session.

#### 6B. Other OpenAI-compatible clients

1. In model settings, change the API address (base_url) to `http://127.0.0.1:57399/v1`; the API Key can be anything or the vision Key.
2. Model name = the **real upstream model name** (e.g. `deepseek-v4-flash`).
3. If the client **won't even let you click the image button** (the front-end hard-blocks by model name) → see FAQ Q3 (modelAliases rename solution).
4. Restart the client and re-test by sending an image.

### Step 7: Hand-off checklist (tick every item)

- [ ] `doctor.mjs` fully PASS (paste the output for the user to see)
- [ ] After the user restarts the client, plain-text chat works (passthrough with zero impact)
- [ ] After the user sends an image, they get a correct answer based on the image content (automatic image recognition works)
- [ ] The user knows: ① don't delete the repo folder; ② the Key lives in `bridge/config.json`; ③ if "does not support this capability" appears again, run `doctor.mjs` first
- [ ] Tell the user how to handle recurrence (one-click fix commands in FAQ Q1/Q2)

---

## The user doesn't want to hand the Key to the AI? Self-service config

```bash
cd auto-vision-bridge
node scripts/setup.mjs        # interactive: pick provider → type Key silently → auto backup → optional 1x1 verification
node bridge/doctor.mjs        # health check; after all PASS, change the client base_url per Step 6 and restart
```

## FAQ (AI troubleshooting quick reference)

### Q1: Sending an image reports "当前模型不支持该能力：vision" (MODEL_CAPABILITY_NOT_SUPPORTED)

- **Root cause**: the client's request **did not go through the bridge** and hit the upstream relay/proxy directly; the upstream blocks image requests based on model capability.
  Most common: `base_url` was switched back to `57321` (operations like cc-switch model switching rewrite config.toml).
- **Diagnose**: `node bridge/doctor.mjs` → if check 6 "Client wiring" FAILs, this is the problem.
- **Fix**:
  1. Change `base_url` back to `http://127.0.0.1:57399/v1` (see Step 6; one-line PowerShell below)
  2. Restart the client
  3. Re-run `doctor.mjs` until check 6 PASSes
- **One-click fix command (Windows)**:
  ```powershell
  $f = "$env:USERPROFILE\.codex\config.toml"
  (Get-Content $f -Raw) -replace 'http://127\.0\.0\.1:57321(/v1)', 'http://127.0.0.1:57399$1' | Set-Content $f -Encoding UTF8
  ```
- **Prevention**: after switching models, run `doctor.mjs` once; on FAIL, fix base_url again.

### Q2: After sending an image the model answers off-topic / says it didn't see the image

- The image never reached the bridge: `base_url` doesn't point to `57399`, or the bridge isn't running.
- Check: `curl http://127.0.0.1:57399/health` → then `node bridge/doctor.mjs`.

### Q3: The client won't even show the image button (front-end hard-blocks by model name)

- Rename the model to a vision-whitelisted name (e.g. `gpt-4o`) in the client, and add an alias in `bridge/config.json` so the bridge maps it back to the real model and **forces image recognition**:
  ```json
  "modelAliases": { "gpt-4o": "deepseek-v4-flash" }
  ```
  After restarting the bridge: the client sends with model `gpt-4o` → the bridge receives `gpt-4o` → maps to `deepseek-v4-flash` + forces the vision model to recognize → the upstream answers normally.

### Q4: Does the upstream itself work? (first step of layered diagnosis)

- Hit the upstream directly (replace `<UPSTREAM>` with the user's relay address):
  ```bash
  curl <UPSTREAM>/v1/models
  ```
- If it doesn't work: the problem is upstream/relay, not this project; have the user fix the upstream first.

### Q5: /health won't connect

- Bridge not started / port occupied / folder moved. Run `node bridge/server.mjs` manually and read the error; if the port is occupied, change `port` in config.json and update the client base_url accordingly.

### Q6: Vision recognition returns 401/403/429

- Wrong Key / provider rate-limit. Re-run `node scripts/setup.mjs --test` to verify the Key; or switch to `glm-4.6v` / another provider.

### Q7: "Model unavailable / invalid model" error

- The upstream doesn't have this model name. The bridge only does image recognition, **it does not switch models** — change the client model name back to one the upstream supports.

### Q8: "Cannot find module '...\bridge\test-bridge.mjs'" (MODULE_NOT_FOUND)

- **Root cause**: the `node bridge/...` command was run **outside the repository folder** (Node only looks for the `bridge` folder under the current directory).
- **Fix**: `cd` into the repo first, then re-run:
  ```bash
  cd auto-vision-bridge        # change to the actual folder you cloned into
  node bridge/test-bridge.mjs --image "full/path/to/image.png"
  ```
- Use a full absolute path for `--image`; wrap it in quotes if it contains spaces. If you forgot where you cloned it, search for it with `Get-ChildItem -Recurse -Filter test-bridge.mjs` (Windows) / `find . -name test-bridge.mjs` (macOS/Linux).
## Rollback (just in case)

1. **Config**: restore backups — `bridge/config.json.bak` back over `bridge/config.json`; `config.toml.bak-*` back over `config.toml`.
2. **Service**: stop the bridge (Windows: end node.exe in Task Manager; Linux: `kill <PID>` or `pm2 stop vision-bridge`).
3. **Client**: change `base_url` back to the original value (it's in the backup file) and restart the client — fully restored.