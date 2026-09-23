// A small, readable preview page for one day file.
import { NEWS_SECTIONS, SECTION_KEYS } from "./rules.mjs";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function renderHtml(digest) {
  const sections = SECTION_KEYS.map((s) => {
    const items = digest.items.filter((i) => i.section === s);
    if (!items.length) return "";
    return `<section><h2>${esc(NEWS_SECTIONS[s])}</h2>${items.map((i) => `
  <article><a href="${esc(i.url)}">${esc(i.title)}</a>
    <p>${esc(i.summary)}</p>
    <small>${esc(i.source)} · ${esc(i.date)} · ${i.tools.map(esc).join(", ")}</small></article>`).join("")}</section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI news ${esc(digest.date)}</title>
<style>
:root{--paper:#f5f3ed;--ink:#222724;--mute:#5f655f;--accent:#c2410c}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.55 Georgia,serif}
main{max-width:680px;margin:0 auto;padding:32px 16px}
h1{font-size:28px;margin:0 0 24px}h2{font:600 13px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:32px 0 8px}
article{border-top:1px solid #d8d4c8;padding:14px 0}a{color:var(--ink);font-weight:700;text-decoration-color:var(--accent)}
p{margin:6px 0}small{font:13px system-ui,sans-serif;color:var(--mute)}
</style></head><body><main><h1>AI news for ${esc(digest.date)}</h1>
${sections}
</main></body></html>
`;
}
