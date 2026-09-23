// Finish a pick from its own source: GitHub description for repos, the page's
// meta description otherwise. A dead link or no usable summary drops the pick.
import { clip, get, getJson, meta, text } from "./text.mjs";

export function makeEnricher({ cfg, token = process.env.GITHUB_TOKEN }) {
  return async function enrich(c) {
    if (c.section === "voices") {
      return { ...c, title: clip(c.title, 120), summary: clip(c.summary, 240) };
    }
    const repo = c.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/);
    if (c.section === "repos" && repo) {
      let g = c.gh;
      if (!g) {
        const headers = { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
        g = (await getJson(`https://api.github.com/repos/${repo[1]}/${repo[2]}`, { headers })).json;
      }
      if (!g || text(g.description || "").length < 40 || g.archived || Number(g.stargazers_count || 0) < cfg.github.minStars) return null;
      const stars = Number(g.stargazers_count || 0).toLocaleString("en-US");
      return { ...c, title: g.full_name, summary: clip(`${text(g.description)} (${stars} stars on GitHub.)`, 240) };
    }
    const page = await get(c.url);
    // Some vendor sites block bots with 401/403; the feed already proved the release exists.
    const blocked = c.section === "releases" && (page.status === 401 || page.status === 403);
    if (!page.status || (page.status >= 400 && !blocked)) return null;
    let summary = c.summary || meta(page.body, "og:description") || meta(page.body, "description");
    if (/^Contribute to .* on GitHub\.?$/i.test(summary)) summary = "";
    if (summary.length < 30 && c.section === "community" && c.points)
      summary = `${c.title}. On Hacker News with ${c.points.toLocaleString("en-US")} points and ${Number(c.comments || 0).toLocaleString("en-US")} comments.`;
    if (summary.length < 30) return null;
    return { ...c, title: clip(c.title, 150), summary: clip(summary, 240) };
  };
}
