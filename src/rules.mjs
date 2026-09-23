// Day-file schema and validator. A day file is { date, items[] }.
// "releases" must link to an official vendor domain. Other sections need any
// https link; the picker also only ever uses URLs from its own candidate list.
export const DEFAULT_DOMAINS = [
  "anthropic.com", "claude.com", "openai.com", "blog.google", "deepmind.google",
  "developers.googleblog.com", "ai.google.dev", "perplexity.ai", "x.ai",
  "github.blog", "huggingface.co", "mistral.ai", "ai.meta.com", "cursor.com",
  "vercel.com", "supabase.com", "cloudflare.com", "n8n.io", "ollama.com",
];
export const NEWS_TOOLS = ["claude", "chatgpt", "codex", "gemini", "perplexity", "grok", "github", "open-source", "other"];
export const NEWS_SECTIONS = {
  releases: "New releases",
  community: "What builders are discussing",
  repos: "Repos & skills",
  voices: "On X",
};
export const SECTION_KEYS = Object.keys(NEWS_SECTIONS);

export function officialUrl(url, domains = DEFAULT_DOMAINS) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return domains.some((d) => u.hostname === d || u.hostname.endsWith("." + d));
  } catch {
    return false;
  }
}
function httpsUrl(url) {
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

export function validateNewsItem(it, at = "item", domains = DEFAULT_DOMAINS) {
  const fail = (m) => { throw new Error(`${at}: ${m}`); };
  if (!it || typeof it !== "object") fail("not an object");
  const section = it.section ?? "releases";
  if (!SECTION_KEYS.includes(section)) fail("section invalid");
  if (typeof it.title !== "string" || it.title.length < 8 || it.title.length > 160) fail("title 8-160 chars");
  if (section === "releases" ? !officialUrl(it.url, domains) : !httpsUrl(it.url)) fail(section === "releases" ? "releases must link to an official source" : "url must be https");
  if (typeof it.source !== "string" || !it.source.trim() || it.source.length > 60) fail("source");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date || "")) fail("date");
  if (typeof it.summary !== "string" || it.summary.length < 30 || it.summary.length > 300) fail("summary 30-300 chars");
  if (!Array.isArray(it.tools) || !it.tools.every((t) => NEWS_TOOLS.includes(t))) fail("tools");
  return { ...it, section };
}

export function validateDigest(raw, file = "digest", domains = DEFAULT_DOMAINS) {
  const fail = (m) => { throw new Error(`${file}: ${m}`); };
  if (!raw || typeof raw !== "object") fail("not an object");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date || "")) fail("date YYYY-MM-DD");
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 20) fail("1-20 items");
  const seen = new Set();
  const items = raw.items.map((it, i) => {
    const v = validateNewsItem(it, `${file} item ${i}`, domains);
    if (seen.has(v.url)) fail(`item ${i}: duplicate url`);
    seen.add(v.url);
    return v;
  });
  return { ...raw, items };
}
