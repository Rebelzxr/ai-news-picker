import { test } from "node:test";
import assert from "node:assert/strict";
import { compileWords, loadConfig } from "../src/config.mjs";
import { fitScore, pickItems, rankIn, scoreCandidates, storyKey, toolsFor } from "../src/score.mjs";

const cfg = loadConfig();
const re = compileWords(cfg.words);
const today = "2026-09-23";
const cand = (o) => ({ summary: "", momentum: 0, date: today, ...o });

test("storyKey groups the same model across vendors", () => {
  assert.equal(storyKey("Introducing Claude Opus 5.5"), "opus 5.5");
  assert.equal(storyKey("Opus 5.5 now in Copilot"), "opus 5.5");
  assert.equal(storyKey("Introducing GPT-6 Sol and Luna"), "gpt-6 sol");
  assert.equal(storyKey("Gemini 3.5 Flash is here"), "gemini 3.5 flash");
  assert.equal(storyKey("A post about spreadsheets"), "");
});

test("fitScore counts different fit words, capped at 3", () => {
  assert.equal(fitScore("nothing relevant here", re.FIT), 0);
  assert.equal(fitScore("Claude agents for your business", re.FIT), 3);
  assert.equal(fitScore("claude claude claude", re.FIT), 1);
});

test("rankIn gives 1 to the top item and 0 to the last", () => {
  const list = [{ s: 5 }, { s: 50 }, { s: 20 }];
  const r = rankIn(list, "s");
  assert.deepEqual(list.map(r), [0, 1, 0.5]);
});

test("toolsFor tags known tools and falls back to other", () => {
  assert.deepEqual(toolsFor("Claude in GitHub", "releases"), ["claude", "github"]);
  assert.deepEqual(toolsFor("a new repo", "repos"), ["open-source"]);
  assert.deepEqual(toolsFor("a quiet post", "community"), ["other"]);
});

test("scoring: launch and core boosts, noise and hype penalties, maker beats reseller", () => {
  const list = [
    cand({ section: "releases", url: "https://www.anthropic.com/news/opus", title: "Introducing Claude Opus 5.5", source: "Anthropic", core: true }),
    cand({ section: "releases", url: "https://vercel.com/changelog/opus", title: "Opus 5.5 now available on AI Gateway", source: "Vercel" }),
    cand({ section: "community", url: "https://example.com/suit", title: "AI lab sued over training data", source: "Hacker News" }),
    cand({ section: "voices", url: "https://x.com/a/status/1", title: "@a: this is insane", source: "@a", trusted: true, hype: true }),
  ];
  const ranked = scoreCandidates(list, { today, cfg, re });
  const by = Object.fromEntries(ranked.map((c) => [c.source, c]));
  assert.equal(ranked[0].source, "Anthropic");
  assert.equal(by.Anthropic.parts.core, 1.6);
  assert.equal(by.Anthropic.parts.launch, 0.8);
  assert.equal(by.Vercel.parts.reseller, -1.5);
  assert.equal(by["Hacker News"].parts.noise, -2);
  assert.equal(by["@a"].parts.hype, -2);
});

test("freshness fades to 0 over three days; seen URLs are skipped", () => {
  const list = [
    cand({ section: "community", url: "https://a.example/1", title: "today", source: "HN" }),
    cand({ section: "community", url: "https://a.example/2", title: "old", source: "HN", date: "2026-09-19" }),
    cand({ section: "community", url: "https://a.example/3", title: "seen", source: "HN" }),
  ];
  const ranked = scoreCandidates(list, { today, cfg, re, seen: new Set(["https://a.example/3"]) });
  assert.equal(ranked.length, 2);
  assert.equal(ranked.find((c) => c.title === "today").parts.freshness, 0.5);
  assert.equal(ranked.find((c) => c.title === "old").parts.freshness, 0);
});

test("pickItems: section caps, one release per vendor, one pick per story, dropped picks", async () => {
  const mk = (section, n, extra = {}) => cand({ section, url: `https://ex.com/${section}/${n}`, title: `${section} item ${n}`, source: `S${n}`, score: 10 - n * 0.5, ...extra });
  const ranked = [
    mk("releases", 1, { source: "OpenAI", title: "Introducing GPT-6 Sol" }),
    mk("releases", 2, { source: "OpenAI" }),             // same vendor: skipped
    mk("releases", 3, { source: "Vercel", title: "GPT-6 Sol on Gateway" }), // same story: skipped
    mk("repos", 4), mk("repos", 5), mk("repos", 6),     // cap 2
    mk("community", 7, { url: "https://dead.example" }), // enrich drops it
    mk("community", 8),
  ].sort((a, b) => b.score - a.score);
  const logs = [];
  const picks = await pickItems(ranked, { cfg, enrich: async (c) => (c.url.includes("dead") ? null : c), log: (m) => logs.push(m) });
  assert.deepEqual(picks.map((p) => p.url), [
    "https://ex.com/releases/1", "https://ex.com/repos/4", "https://ex.com/repos/5", "https://ex.com/community/8",
  ]);
  assert.match(logs[0], /^dropped/);
});

test("pickItems fills up to minItems below the quality floor", async () => {
  const ranked = [1, 2, 3].map((n) => cand({ section: n === 1 ? "repos" : "community", url: `https://ex.com/${n}`, title: `low item ${n}`, source: "S", score: 1 }));
  const picks = await pickItems(ranked, { cfg, enrich: async (c) => c });
  assert.equal(picks.length, 3);
});

test("hype penalty applies to every candidate, not only X posts", () => {
  const list = [
    cand({ section: "community", url: "https://ex.com/h1", title: "This insane new agent does it all", source: "Hacker News" }),
    cand({ section: "repos", url: "https://ex.com/h2", title: "a/b", summary: "Agent toolkit 🚨 read this now", source: "GitHub" }),
    cand({ section: "community", url: "https://ex.com/h3", title: "A calm agent write-up", source: "Hacker News" }),
  ];
  const by = Object.fromEntries(scoreCandidates(list, { today, cfg, re }).map((c) => [c.url, c.parts.hype]));
  assert.deepEqual(by, { "https://ex.com/h1": -2, "https://ex.com/h2": -2, "https://ex.com/h3": 0 });
});
