// Built-in collectors. None of them need an API key.
//   releases  official vendor RSS/Atom feeds, plus the Anthropic and Claude news pages
//   community Hacker News (official Algolia API), AI stories only
//   repos     GitHub search API: new AI repos sorted by stars
//   extra     any list you pass with --extra (X posts, newsletters, your own finds)
import { readFileSync } from "node:fs";
import { feedItems } from "./feeds.mjs";
import { officialUrl, SECTION_KEYS } from "./rules.mjs";
import { rankIn } from "./score.mjs";
import { MONTHS, get, getJson, localDay, meta, parseDate, text } from "./text.mjs";

const ageH = (d, now) => (now - d.getTime()) / 3600e3;
const DATE_RE = () => new RegExp(`(?:${MONTHS})\\.? \\d{1,2}, 20\\d\\d`, "g");
const calendarDay = (label) => { const d = parseDate(label.replace("Sept", "Sep")); return d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : ""; };

// The article's own date is the first "Month D, YYYY" on its page. Later dates are
// often related-post links, so "the listing date appears somewhere" is not enough.
export function articleMatchesDate(html, listingLabel) {
  const first = String(html).match(DATE_RE());
  return !!first && calendarDay(first[0]) !== "" && calendarDay(first[0]) === calendarDay(listingLabel);
}
const stripHN = (t) => String(t).replace(/^(Show|Launch|Ask) HN:\s*/i, "");

export function candidateStore() {
  const list = [];
  const add = (c) => {
    if (!c.url || !/^https:\/\//.test(c.url)) return;
    const item = { summary: "", momentum: 0, ...c, title: text(c.title).slice(0, 200), summary: text(c.summary || "") };
    const i = list.findIndex((x) => x.url === c.url);
    if (i < 0) return void list.push(item);
    // The official release wins over a Hacker News (or other) copy of the same URL,
    // and keeps the higher momentum of the two, whichever arrives first.
    const existing = list[i];
    if (item.section === "releases" && existing.section !== "releases") list[i] = { ...item, momentum: Math.max(item.momentum, existing.momentum || 0) };
    else if (existing.section === "releases") existing.momentum = Math.max(existing.momentum || 0, item.momentum || 0); // either order keeps the higher momentum
  };
  return { list, add };
}

export async function collectFeeds({ cfg, add, now, stats }) {
  const core = new Set(cfg.coreSources);
  await Promise.all(cfg.feeds.map(async ([source, feed]) => {
    const { status, body } = await get(feed);
    const items = feedItems(body).filter((i) => i.date && ageH(i.date, now) >= -24 && ageH(i.date, now) < cfg.releaseWindowHours && officialUrl(i.url, cfg.officialDomains));
    stats.push(`${source} ${status === 200 ? items.length : `http ${status}`}`);
    items.forEach((i) => add({ section: "releases", url: i.url, title: i.title, summary: i.summary, source, date: localDay(i.date, cfg.utcOffsetHours), core: core.has(source) }));
  }));
}

// Listing pages without a feed: each recent date on the page is paired with its
// nearest article link, and kept only if that article's own (first) date is the same day.
export async function collectPages({ cfg, add, now, stats }) {
  await Promise.all(cfg.pages.map(async ({ source, page, origin, skip }) => {
    const skipRe = new RegExp(skip);
    const { status, body } = await get(page);
    const host = origin.replace(/^https:\/\/(www\.)?/, "").replace(/\./g, "\\.");
    const hrefs = [...body.matchAll(new RegExp(`href="((?:https://(?:www\\.)?${host})?/[a-z0-9/-]+)"`, "g"))]
      .map((m) => ({ at: m.index, path: m[1].replace(/^https:\/\/[^/]+/, "") })).filter((h) => !skipRe.test(h.path));
    const recent = [...body.matchAll(DATE_RE())]
      .map((m) => ({ at: m.index, label: m[0], date: parseDate(m[0].replace("Sept", "Sep")) }))
      .filter((d) => d.date && ageH(d.date, now) < cfg.releaseWindowHours + 24);
    let kept = 0;
    const done = new Set();
    for (const d of recent) {
      const near = hrefs.filter((h) => Math.abs(h.at - d.at) < 900 && !done.has(h.path)).sort((a, b) => Math.abs(a.at - d.at) - Math.abs(b.at - d.at)).slice(0, 3);
      for (const h of near) {
        const art = await get(origin + h.path);
        if (art.status !== 200 || !articleMatchesDate(art.body, d.label)) continue; // try the next-nearest link
        done.add(h.path);
        const title = meta(art.body, "og:title") || text((art.body.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
        add({ section: "releases", url: origin + h.path, title: title.replace(/\s*[|\\–-]\s*(Claude by Anthropic|Anthropic|Claude)\s*$/i, ""), summary: meta(art.body, "og:description") || meta(art.body, "description"), source, date: localDay(new Date(d.date.getTime() - d.date.getTimezoneOffset() * 60000), 0), core: true }); // the calendar day printed on the page
        kept++;
        break;
      }
    }
    stats.push(`${source} ${status === 200 ? kept : `http ${status}`}`);
  }));
}

export async function collectHackerNews({ cfg, re, add, now, stats }) {
  const { hours, minPoints } = cfg.hackerNews;
  const since = Math.floor(now / 1000 - hours * 3600);
  const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=created_at_i>${since},points>=${minPoints}&hitsPerPage=500`;
  const { status, json } = await getJson(url);
  const hits = (json?.hits || []).map((h) => ({
    title: stripHN(h.title || ""),
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    score: Number(h.points || 0),
    comments: Number(h.num_comments || 0),
    created: h.created_at,
  }));
  const ai = hits.filter((i) => re.AI.test(i.title)), r = rankIn(ai, "score");
  ai.forEach((i) => add({ section: "community", url: i.url, title: i.title, source: "Hacker News", date: localDay(new Date(i.created), cfg.utcOffsetHours), momentum: r(i), points: i.score, comments: i.comments }));
  stats.push(`Hacker News ${status === 200 ? `${ai.length}/${hits.length}` : `http ${status}`}`);
}

export async function collectGitHub({ cfg, add, today, stats, token = process.env.GITHUB_TOKEN }) {
  const { createdWithinDays, minStars, keywords } = cfg.github;
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - createdWithinDays * 86400e3).toISOString().slice(0, 10);
  const q = `${keywords.join(" OR ")} in:name,description,topics created:>${since} stars:>=${minStars} archived:false`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=50`;
  const headers = { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const { status, json } = await getJson(url, { headers });
  const repos = (json?.items || []).filter((g) => g.html_url && !g.fork);
  const r = rankIn(repos, "stargazers_count");
  repos.forEach((g) => add({ section: "repos", url: g.html_url, title: g.full_name, summary: g.description || "", source: "GitHub", date: today, momentum: r(g), gh: { full_name: g.full_name, description: g.description, stargazers_count: g.stargazers_count, archived: g.archived } }));
  stats.push(`GitHub search ${status === 200 ? repos.length : `http ${status}`}`);
}

// --extra file: a JSON array (or { items: [...] }) of either
//   generic candidates { section, url, title, summary, source, date, momentum|score }
//   X posts            { url, handle, excerpt, topic, bookmarks, posted }
// X posts count only from trusted handles and only if they are about AI.
export function loadExtra(file, { cfg, re, add, today, stats }) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const items = Array.isArray(raw) ? raw : raw.items || [];
  const day = (ts) => (typeof ts === "string" && /^\d{4}-\d{2}-\d{2}/.test(ts) ? ts.slice(0, 10) : today);
  const trusted = new Set(cfg.trustedHandles.map((h) => h.toLowerCase()));

  const xs = items.filter((p) => p.handle && p.excerpt && /^https:\/\/(x|twitter)\.com\/[^/]+\/status\//.test(p.url || "") && re.AI.test(`${p.topic || ""} ${p.excerpt}`));
  const rx = rankIn(xs, "bookmarks");
  let n = 0;
  xs.filter((p) => trusted.has(String(p.handle).toLowerCase())).forEach((p) => {
    add({ section: "voices", url: p.url, title: `@${p.handle}: ${p.excerpt}`, summary: p.excerpt, source: `@${p.handle}`, date: day(p.posted), momentum: rx(p), trusted: true, hype: re.HYPE.test(p.excerpt) });
    n++;
  });

  const generic = items.filter((c) => !c.handle && SECTION_KEYS.includes(c.section) && c.url && c.title);
  for (const section of SECTION_KEYS) {
    const list = generic.filter((c) => c.section === section), r = rankIn(list, "score");
    for (const c of list) {
      if (section === "releases" && !officialUrl(c.url, cfg.officialDomains)) continue;
      add({ section, url: c.url, title: stripHN(c.title), summary: c.summary || "", source: String(c.source || "Community"), date: day(c.date), momentum: typeof c.momentum === "number" ? c.momentum : r(c), core: section === "releases" && cfg.coreSources.includes(c.source) });
      n++;
    }
  }
  stats.push(`extra ${n}`);
}
