// Optional polish hook. Off by default. Any command you like (a model CLI, a
// script, a local LLM) receives the picked items as JSON on stdin:
//   { "instructions": "...", "items": [{ "i": 0, "source": "...", "title": "...", "summary": "..." }] }
// and must print JSON on stdout:
//   { "items": [{ "i": 0, "title": "...", "summary": "..." }] }
// Every rewrite is checked. Anything that fails a check keeps its plain text,
// and any failure of the command itself keeps the whole plain list.
import { spawnSync } from "node:child_process";
import { compileWords, loadConfig } from "./config.mjs";
import { validateNewsItem } from "./rules.mjs";

export const POLISH_INSTRUCTIONS = `Rewrite these AI news items for readers who use AI for real work.
For each item return the same i, a title in plain words (max 110 chars) and a summary of 1-2 sentences (max 230 chars): what it is and who it helps.
Use only facts in the given text. No hype, no quotes, no numbers that are not in the given text. Do not browse.`;

// Whole numbers, not substrings: "687" must not let "$68 million" through.
const nums = (s) => (s.match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/,/g, "").replace(/\.$/, ""));
// Number words and "10x" style multipliers a rewrite must not add.
const NUMBER_WORDS = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|trillions?|dozens?|percent|double[sd]?|triple[sd]?|twice)\b|\b(?:two|three|four|five|six|seven|eight|nine|ten|twenty|hundred|thousand|\d+)[- ]?fold\b|\d+\s*[x×](?![a-z])/gi;
const numberWords = (s) => new Set((s.match(NUMBER_WORDS) || []).map((w) => w.toLowerCase().replace(/\s+/g, "")));
let defaultHype;
const hypeDefault = () => (defaultHype ??= compileWords(loadConfig().words).HYPE);

// Pure check, exported for tests: returns the list with safe rewrites applied.
export function applyPolish(list, out, domains, hype = hypeDefault()) {
  let changed = 0;
  const next = list.map((it, i) => {
    const p = Array.isArray(out) ? out.find((o) => o && o.i === i) : null;
    if (!p || typeof p.title !== "string" || typeof p.summary !== "string") return it;
    const source = `${it.title} ${it.summary}`;
    const cand = { ...it, title: p.title.trim(), summary: p.summary.trim() };
    try { validateNewsItem(cand, "polish", domains); } catch { return it; }
    if (cand.title.length > 120 || cand.summary.length > 240) return it;
    const rewrite = `${cand.title} ${cand.summary}`;
    const known = new Set(nums(source));
    if (nums(rewrite).some((n) => !known.has(n))) return it; // no invented numbers
    const words = numberWords(source);
    if ([...numberWords(rewrite)].some((w) => !words.has(w))) return it; // no invented "ten million" or "10x"
    if (hype.test(rewrite) && !hype.test(source)) return it; // no added hype
    changed++;
    return cand;
  });
  return { items: next, changed };
}

export function polishWithCommand(list, cmd, { domains, hype, timeoutMs = 5 * 60 * 1000, log = () => {} } = {}) {
  try {
    const input = JSON.stringify({ instructions: POLISH_INSTRUCTIONS, items: list.map((it, i) => ({ i, source: it.source, title: it.title, summary: it.summary })) });
    const r = spawnSync(cmd, { shell: true, input, encoding: "utf8", timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
    if (r.error || r.status !== 0) {
      log(`polish skipped, plain titles kept (${r.error ? r.error.code || r.error.message : `exit ${r.status}`})`);
      return list;
    }
    const out = JSON.parse(r.stdout).items;
    const { items, changed } = applyPolish(list, out, domains, hype);
    log(`polish rewrote ${changed}/${list.length} items`);
    return items;
  } catch (e) {
    log(`polish skipped, plain titles kept (${e.message})`);
    return list;
  }
}
