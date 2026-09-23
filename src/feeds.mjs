// RSS 2.0 and Atom parsing with plain regular expressions (no XML dependency).
import { decode, parseDate, text } from "./text.mjs";

export function feedItems(xml) {
  return [...String(xml).matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)].map(([block]) => {
    const tag = (n) => (block.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)) || [])[1] || "";
    const link = text(tag("link"))
      || (block.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)/) || block.match(/<link[^>]+href=["']([^"']+)/) || [])[1] || "";
    const summary = text(tag("description") || tag("summary") || tag("content")).replace(/\s*The post .* appeared first on .*$/i, "");
    return {
      title: text(tag("title")),
      url: decode(link).trim(),
      date: parseDate(tag("pubDate") || tag("published") || tag("updated") || tag("dc:date")),
      summary,
    };
  });
}
