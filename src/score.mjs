// Plain-code scoring and picking. No model involved.
import { NEWS_TOOLS } from "./rules.mjs";

// One pick per story: "Introducing Claude Opus 5.5" and "Opus 5.5 now in Copilot" share a key.
const MODEL = /\b((?:claude\s+)?(?:opus|sonnet|haiku|fable|mythos)\s*\d+(?:\.\d+)?|gpt-?\d+(?:\.\d+)?(?:\s+(?:sol|luna|astra))?|gemini\s*\d+(?:\.\d+)?(?:\s*(?:pro|flash|ultra))?|grok\s*\d+(?:\.\d+)?|mimo\s*v?\d+(?:\.\d+)?|llama\s*\d+(?:\.\d+)?|qwen\s*\d+(?:\.\d+)?|deepseek\s*v?\d+(?:\.\d+)?)\b/i;
export const storyKey = (title) => {
  const m = String(title).match(MODEL);
  return m ? m[1].toLowerCase().replace(/^claude\s+/, "").replace(/\s+/g, " ") : "";
};

// Audience fit: how many different fit words appear, capped at 3.
export const fitScore = (s, FIT) => Math.min(3, new Set((String(s).match(FIT) || []).map((w) => w.toLowerCase())).size);

export const toolsFor = (s, section) => {
  const t = new Set();
  if (/claude|anthropic/i.test(s)) t.add("claude");
  if (/chatgpt|openai|\bgpt/i.test(s)) t.add("chatgpt");
  if (/codex/i.test(s)) t.add("codex");
  if (/gemini|google|deepmind/i.test(s)) t.add("gemini");
  if (/perplexity/i.test(s)) t.add("perplexity");
  if (/grok|x\.ai/i.test(s)) t.add("grok");
  if (/github/i.test(s)) t.add("github");
  if (section === "repos") t.add("open-source");
  const known = [...t].filter((x) => NEWS_TOOLS.includes(x));
  return known.length ? known : ["other"];
};

// Momentum within one source: 1 for the top item, falling to 0 for the last.
export const rankIn = (list, key) => {
  const sorted = [...list].sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0));
  return (it) => (sorted.length > 1 ? 1 - sorted.indexOf(it) / (sorted.length - 1) : 1);
};

// Adds c.score to every candidate and returns them best first, minus repeats.
export function scoreCandidates(candidates, { today, cfg, re, seen = new Set() }) {
  const base = cfg.sectionBase;
  for (const c of candidates) {
    const words = `${c.title} ${c.summary}`;
    const freshness = Math.max(0, 1 - (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${c.date}T12:00:00Z`)) / (3 * 86400e3));
    const parts = {
      base: base[c.section] ?? 0,
      fit: fitScore(words, re.FIT) * 0.6,
      momentum: (c.momentum || 0) * 1.5,
      freshness: freshness * 0.5,
      launch: c.section === "releases" && re.LAUNCH.test(c.title) ? 0.8 : 0,
      core: (c.core ? 0.6 : 0) + (c.core && re.LAUNCH.test(c.title) ? 1 : 0),
      trusted: c.trusted ? 1 : 0,
      noise: re.NOISE.test(c.title) ? -2 : 0,
      hype: c.hype || re.HYPE.test(words) ? -2 : 0,
      reseller: 0,
    };
    c.parts = parts;
    c.score = Object.values(parts).reduce((a, b) => a + b, 0);
  }
  // The maker's own post beats a reseller's post about the same model.
  const coreKeys = new Set(candidates.filter((c) => c.core && storyKey(c.title)).map((c) => storyKey(c.title)));
  for (const c of candidates) {
    if (!c.core && c.section !== "voices" && coreKeys.has(storyKey(c.title))) { c.parts.reseller = -1.5; c.score -= 1.5; }
  }
  return candidates.filter((c) => !seen.has(c.url)).sort((a, b) => b.score - a.score);
}

// Two passes: first up to maxItems above the quality floor, then fill to
// minItems with whatever is left. Caps: per section, one release per vendor,
// one pick per story. enrich(c) returns the finished pick or null to drop it.
export async function pickItems(ranked, { cfg, enrich, log = () => {} }) {
  const picks = [];
  const used = Object.fromEntries(Object.keys(cfg.sectionCaps).map((k) => [k, 0]));
  const vendors = new Set(), tried = new Set(), stories = new Set();
  for (const pass of [cfg.qualityFloor, -Infinity]) {
    const target = pass === cfg.qualityFloor ? cfg.maxItems : cfg.minItems;
    for (const c of ranked) {
      if (picks.length >= target) break;
      if (c.score < pass || picks.some((p) => p.url === c.url) || (used[c.section] ?? 0) >= (cfg.sectionCaps[c.section] ?? 0)) continue;
      const key = c.section === "voices" ? "" : storyKey(c.title);
      if ((c.section === "releases" && vendors.has(c.source)) || tried.has(c.url) || (key && stories.has(key))) continue;
      tried.add(c.url);
      const e = await enrich(c);
      if (!e) { log(`dropped (no live page or summary) ${c.section} ${c.title.slice(0, 80)}`); continue; }
      picks.push(e);
      used[c.section]++;
      if (c.section === "releases") vendors.add(c.source);
      if (key) stories.add(key);
    }
  }
  return picks;
}
