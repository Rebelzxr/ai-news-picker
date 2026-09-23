#!/usr/bin/env node
// ai-news-picker: pick 3-5 AI news items a day with plain code.
//  1. Collect candidates (vendor feeds, Anthropic/Claude pages, Hacker News, GitHub, --extra).
//  2. Score them (audience fit, momentum, freshness, launch words, maker over reseller,
//     noise and hype penalties), skip anything used in the last 14 days, keep the best
//     3-5 with per-section caps and one pick per story.
//  3. Read each pick's summary from its own source; a dead link drops the pick.
//  4. Optional polish hook (off by default), then validate and write YYYY-MM-DD.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { candidateStore, collectFeeds, collectGitHub, collectHackerNews, collectPages, loadExtra } from "../src/collectors.mjs";
import { compileWords, loadConfig } from "../src/config.mjs";
import { makeEnricher } from "../src/enrich.mjs";
import { renderHtml } from "../src/html.mjs";
import { polishWithCommand } from "../src/polish.mjs";
import { SECTION_KEYS, validateDigest } from "../src/rules.mjs";
import { pickItems, scoreCandidates, toolsFor } from "../src/score.mjs";
import { clip, localDay } from "../src/text.mjs";

const HELP = `Usage: ai-news-picker [options]

  --out <dir>          where day files go (default: config outDir, ./news)
  --config <file>      your config.json; merged over the built-in defaults
  --extra <file>       extra candidates as JSON (X posts or any list)
  --explain            print the top 20 scores and what made them
  --dry-run            collect, score and pick, but write nothing
  --polish-cmd "<cmd>" optional rewrite step; gets items as JSON on stdin
  --webhook            POST the day file to config.webhook.url
  --html               also write YYYY-MM-DD.html, a small preview page
  --force              replace today's file if it already exists
  --help               show this help`;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };
if (flag("--help") || flag("-h")) { console.log(HELP); process.exit(0); }

const log = (m) => console.log(`ai-news-picker: ${m}`);
const cfg = loadConfig(opt("--config"));
const re = compileWords(cfg.words);
const now = Date.now();
const today = localDay(new Date(now), cfg.utcOffsetHours);
const outDir = resolve(opt("--out") || cfg.outDir);
const outFile = join(outDir, `${today}.json`);
const shown = (f) => { const r = relative(process.cwd(), f); return r && !r.startsWith("..") ? r : f; }; // short paths in logs
const dryRun = flag("--dry-run");

if (existsSync(outFile) && !flag("--force") && !dryRun) {
  log(`${today} already exists in ${shown(outDir)}, skipping (use --force)`);
  process.exit(0);
}

// ---- 1. collect -------------------------------------------------------------
const { list: candidates, add } = candidateStore();
const stats = [];
const ctx = { cfg, re, add, now, today, stats };
const extra = opt("--extra");
if (extra) { // first; on a duplicate URL the first copy stays, except that an official release replaces a non-release copy
  try { loadExtra(extra, ctx); } catch (e) {
    console.error(`ai-news-picker: cannot read --extra ${extra}: ${e.code === "ENOENT" ? "file not found" : e.message}`);
    process.exit(1);
  }
}
await Promise.all([
  collectFeeds(ctx),
  collectPages(ctx),
  cfg.hackerNews.enabled ? collectHackerNews(ctx) : null,
  cfg.github.enabled ? collectGitHub(ctx) : null,
]);
const count = (s) => candidates.filter((c) => c.section === s).length;
log(`candidates ${SECTION_KEYS.map((s) => `${s} ${count(s)}`).join(", ")}`);
log(`sources ${stats.sort().join(", ")}`);

// ---- 2. score and pick ------------------------------------------------------
const seen = new Set();
if (existsSync(outDir)) {
  for (const f of readdirSync(outDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(-cfg.repeatDays)) {
    if (f === `${today}.json`) continue;
    try { JSON.parse(readFileSync(join(outDir, f), "utf8")).items.forEach((i) => seen.add(i.url)); } catch { /* unreadable day file */ }
  }
}
const ranked = scoreCandidates(candidates, { today, cfg, re, seen });
if (seen.size) log(`skipping ${seen.size} links used in the last ${cfg.repeatDays} day files`);
if (flag("--explain")) {
  for (const c of ranked.slice(0, 20)) {
    console.log(`  rank ${c.score.toFixed(2)} ${c.section.padEnd(9)} ${c.source.slice(0, 18).padEnd(18)} ${c.title.slice(0, 80)}`);
    const why = Object.entries(c.parts).filter(([, v]) => v).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v.toFixed(2)}`).join("  ");
    console.log(`       ${why}`);
  }
}

const picks = await pickItems(ranked, { cfg, enrich: makeEnricher({ cfg }), log });
if (!picks.length) {
  console.error("ai-news-picker: no usable picks today; nothing written");
  process.exit(1);
}
picks.forEach((p) => log(`pick ${p.section} ${p.score.toFixed(2)} ${p.source} | ${p.title.slice(0, 90)}`));
let items = picks.map((p) => ({ section: p.section, url: p.url, title: p.title, source: clip(p.source, 60), date: p.date, summary: p.summary, tools: toolsFor(`${p.title} ${p.summary} ${p.source} ${p.url}`, p.section) }));

// ---- 3. optional polish (never blocks) --------------------------------------
const polishCmd = opt("--polish-cmd");
if (polishCmd) items = polishWithCommand(items, polishCmd, { domains: cfg.officialDomains, hype: re.HYPE, log });

// ---- 4. validate, write, send -------------------------------------------------
const digest = validateDigest({ date: today, items }, "picked news", cfg.officialDomains);
const counts = SECTION_KEYS.map((s) => `${s} ${digest.items.filter((i) => i.section === s).length}`).join(", ");
if (dryRun) {
  console.log(JSON.stringify(digest, null, 2));
  log(`dry run: ${digest.items.length} items (${counts}), nothing written`);
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify(digest, null, 2) + "\n");
log(`wrote ${shown(outFile)} (${digest.items.length} items: ${counts})`);
if (flag("--html")) {
  writeFileSync(join(outDir, `${today}.html`), renderHtml(digest));
  log(`wrote ${shown(join(outDir, `${today}.html`))}`);
}

if (flag("--webhook")) {
  const { url, secretEnv } = cfg.webhook;
  if (!url) {
    log("webhook skipped: config.webhook.url is empty");
  } else if (!/^https:\/\//i.test(url)) {
    console.error("ai-news-picker: webhook refused: config.webhook.url must start with https:// (the day file and secret are not sent over plain http)");
    process.exitCode = 2;
  } else {
    const secret = secretEnv ? process.env[secretEnv] || "" : "";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify(digest),
      signal: AbortSignal.timeout(30000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
    log(`webhook ${new URL(url).origin} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
    if (!res.ok) process.exitCode = 2;
  }
}
