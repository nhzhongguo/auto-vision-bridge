/**
 * Codex client wiring helpers used by the resident bridge.
 *
 * CC Switch rewrites Codex's base_url when a provider is hot-switched. The
 * bridge must remain the first hop, otherwise CC Switch rejects image input
 * before the bridge can convert it to text.
 */

export function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

export function isSameUrl(left, right) {
  return normalizeUrl(left) === normalizeUrl(right);
}

export function extractBaseUrl(text) {
  const match = String(text || "").match(/^\s*base_url\s*=\s*(["'])([^"']+)\1([^\r\n]*)$/m);
  return match ? match[2] : "";
}

/**
 * Replace an existing top-level base_url while preserving quote style and
 * any inline comment. Deliberately does not insert a new setting: a missing
 * base_url may belong to a different Codex configuration shape.
 */
export function ensureBaseUrl(text, targetUrl) {
  const source = String(text || "");
  const target = String(targetUrl || "").trim();
  if (!target) return { text: source, changed: false, found: false, previous: "" };

  const match = source.match(/^(\s*base_url\s*=\s*)(["'])([^"']+)(\2)([^\r\n]*)$/m);
  if (!match) return { text: source, changed: false, found: false, previous: "" };

  const previous = match[3];
  if (isSameUrl(previous, target)) {
    return { text: source, changed: false, found: true, previous };
  }

  const replacement = `${match[1]}${match[2]}${target}${match[4]}${match[5]}`;
  return {
    text: source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length),
    changed: true,
    found: true,
    previous,
  };
}
