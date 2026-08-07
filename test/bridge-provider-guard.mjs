#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  VISION_PROVIDERS,
  resolveVisionProvider,
  buildVisionEndpoint,
} from "../bridge/providers.mjs";

for (const id of ["zhipu", "siliconflow", "groq", "openrouter", "github"]) {
  assert.equal(resolveVisionProvider(id)?.style, "openai", `${id} should be OpenAI-compatible`);
}
assert.equal(resolveVisionProvider("gemini")?.style, "gemini");
assert.equal(resolveVisionProvider("cloudflare")?.style, "cloudflare");
assert.equal(resolveVisionProvider("ollama")?.requiresKey, false);
assert.equal(resolveVisionProvider("ollama")?.endpoint, "http://127.0.0.1:11434/v1/chat/completions");

const geminiUrl = buildVisionEndpoint(resolveVisionProvider("gemini"), "gemini-2.5-flash");
assert.match(geminiUrl, /\/models\/gemini-2\.5-flash:generateContent$/);

const cloudflareUrl = buildVisionEndpoint(
  resolveVisionProvider("cloudflare"),
  "@cf/meta/llama-3.2-11b-vision-instruct",
  "abc-account",
);
assert.match(cloudflareUrl, /\/accounts\/abc-account\/ai\/run\/%40cf\/meta\/llama-3\.2-11b-vision-instruct$/);

const oldAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
delete process.env.CLOUDFLARE_ACCOUNT_ID;
try {
  assert.throws(
    () => buildVisionEndpoint(resolveVisionProvider("cloudflare"), "@cf/meta/llama-3.2-11b-vision-instruct", ""),
    /Account ID/,
  );
} finally {
  if (oldAccount !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = oldAccount;
}

assert.ok(VISION_PROVIDERS.zhipu.endpoint.startsWith("https://"));
console.log("bridge provider guard tests passed");
