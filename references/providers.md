# 视觉模型服务商清单

配置向导会根据服务商展示**内置的视觉模型目录**，只允许选择目录中标记为 `vision: true` 的模型；不会拿纯文本模型试错。模型和价格可能随服务商调整，以下 `billing` 仅用于安全提示，最终以服务商控制台为准。

| 服务商 | 内置视觉模型示例 | 计费提示 | 获取 Key |
|---|---|---|---|
| 智谱 BigModel | `glm-4.6v`、`glm-4.6v-flash`、`glm-4.5v` | `glm-4.6v` / Flash 标为免费档；`glm-4.5v` 标为可能计费 | open.bigmodel.cn → API Keys |
| SiliconFlow | `Qwen/Qwen2.5-VL-7B-Instruct`、`Qwen/Qwen2-VL-7B-Instruct`、`THUDM/glm-4v-9b` | 当前目录标为免费档，可能限流或耗尽额度 | cloud.siliconflow.cn → API 密钥 |
| Groq | `llama-3.2-11b-vision-preview`、`llama-3.2-90b-vision-preview` | 免费档/限速提示 | console.groq.com/keys |
| OpenRouter | `Qwen/Qwen2.5-VL-7B-Instruct:free`、Llama Vision `:free` | `:free` 档；仍受供应商和路由规则影响 | openrouter.ai/keys |
| GitHub Models | `gpt-4o-mini`、`gpt-4o`、Llama Vision、Phi Vision | 按账号免费限速/额度提示 | GitHub → Settings → Developer settings → Personal access tokens |
| Google Gemini | `gemini-2.5-flash`、`gemini-2.0-flash` | 免费档/限速提示 | aistudio.google.com/apikey |
| Cloudflare Workers AI | `@cf/meta/llama-3.2-11b-vision-instruct`、`@cf/qwen/qwen2.5-vl-7b-instruct` | 免费额度内；本向导暂不自动测试专用协议 | dash.cloudflare.com → Workers AI |
| 任意 OpenAI 兼容服务 | 用户提供的视觉模型 | 价格未知，默认不测试 | 服务商控制台 |

## 计费安全规则

- `free` 只表示目录当前标记为免费额度/免费档，不代表永久免费；可能限流、排队或耗尽额度。
- `paid` 或 `unknown` 模型在 `setup.mjs` 和 `doctor.mjs --test` 中默认跳过联网测试。
- 只有用户明确确认可能产生费用后，才在向导中继续测试；体检脚本需要显式加 `--force`。
- 自定义模型如果名称不能确认视觉能力，会保存配置但跳过自动验证。
- 真实费用、免费额度、套餐限制必须以服务商控制台和账单页面为准。

## 判断模型是否支持视觉

首选使用向导内置目录，不要只靠名称猜测。自定义端点只能做保守提示：模型名通常带 `vl`、`vision`、`omni`、`multimodal`、`4v`、`4o`、`claude`、`gemini`、`llava`、`internvl`、`minicpm`、`flash` 等标记，但名称命中不等于服务商一定支持图片。

纯文本模型不要填成视觉模型，例如 `glm-4-flash`、`glm-4-air`、`deepseek-*`、`kimi`、`qwen-turbo`、`qwen-plus`。

## 连接失败排查

| 现象 | 原因 | 让用户检查 |
|---|---|---|
| HTTP 401 / 403 | Key 无效、权限不足 | 复制 Key 时不要带空格/引号；去服务商控制台核对；部分服务需要先启用模型 |
| HTTP 402 | 账号余额/额度不足 | 确认套餐与余额，或换明确免费档；不要为了重试盲目充值 |
| HTTP 429 | 触发限流 | 稍等重试，或换免费档模型/服务商 |
| HTTP 400 | 模型名错误，或模型不支持图片 | 回到内置目录选择视觉模型；自定义端点核对图片协议 |
| HTTP 5xx | 服务商临时故障 | 稍后重试 |
| 网络错误 / 超时 | 端点 URL 错误或网络不通 | 核对 `baseUrl` 是否与服务商文档一致；确认能访问外网 |
| 返回空内容 | 模型不支持图片或服务端异常 | 换成目录中确认可用的视觉模型 |
