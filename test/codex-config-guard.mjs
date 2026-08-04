#!/usr/bin/env node
import assert from "node:assert/strict";
import { ensureBaseUrl, extractBaseUrl, isSameUrl } from "../bridge/codex-config.mjs";

const source = [
  'model = "deepseek-v4-flash-0731"',
  'base_url = "http://127.0.0.1:15721/v1" # CC Switch local proxy',
  '',
].join("\n");
const target = "http://127.0.0.1:57399/v1";
const changed = ensureBaseUrl(source, target);
assert.equal(changed.changed, true);
assert.equal(changed.found, true);
assert.equal(changed.previous, "http://127.0.0.1:15721/v1");
assert.equal(extractBaseUrl(changed.text), target);
assert.match(changed.text, /# CC Switch local proxy/);

const idempotent = ensureBaseUrl(changed.text, target);
assert.equal(idempotent.changed, false);
assert.equal(idempotent.found, true);
assert.equal(isSameUrl("HTTP://127.0.0.1:57399/v1/", target), true);

const missing = ensureBaseUrl('model = "x"\n', target);
assert.equal(missing.changed, false);
assert.equal(missing.found, false);

console.log("codex-config guard tests passed");
