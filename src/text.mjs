// Small text helpers shared by the collectors and the picker.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…" };

export const decode = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, e) => ENT[e.toLowerCase()] ?? m);

// Strip tags, decode entities twice (feeds often double-encode), squash spaces.
export const text = (s) => decode(decode(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();

// Cut at a word boundary and add an ellipsis.
export const clip = (s, max) => {
  if (s.length <= max) return s;
  const sp = s.lastIndexOf(" ", max - 1);
  return s.slice(0, sp > max * 0.6 ? sp : max - 1).replace(/[\s,.;:–—-]+$/, "") + "…";
};

export const parseDate = (s) => { const d = new Date(String(s || "").trim()); return isNaN(d) ? null : d; };

// Date string (YYYY-MM-DD) for a Date in the configured UTC offset.
export const localDay = (d, offsetHours = 0) => new Date(d.getTime() + offsetHours * 3600e3).toISOString().slice(0, 10);

export function meta(html, key) {
  const tag = String(html).match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"));
  return tag ? text((tag[0].match(/content=["']([^"']*)["']/i) || [])[1] || "") : "";
}

export const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

const UA = { "User-Agent": "Mozilla/5.0 ai-news-picker" };

// GET that never throws: { status: 0 } on network failure, empty body on 4xx/5xx.
export async function get(url, { ms = 20000, headers = {} } = {}) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(ms), headers: { ...UA, ...headers } }).catch(() => null);
  if (!res) return { status: 0, body: "" };
  return { status: res.status, body: res.status < 400 ? (await res.text().catch(() => "")).slice(0, 400000) : "" };
}

export async function getJson(url, { ms = 20000, headers = {} } = {}) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(ms), headers: { ...UA, ...headers } }).catch(() => null);
  if (!res) return { status: 0, json: null };
  return { status: res.status, json: res.ok ? await res.json().catch(() => null) : null };
}
