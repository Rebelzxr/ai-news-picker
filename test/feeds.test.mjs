import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { feedItems } from "../src/feeds.mjs";
import { clip, text } from "../src/text.mjs";

const fixture = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

test("RSS: title, link, date and cleaned summary", () => {
  const [a, b] = feedItems(fixture("rss.xml"));
  assert.equal(a.title, "Introducing Example Agents & Skills");
  assert.equal(a.url, "https://openai.com/index/example-agents");
  assert.equal(a.date.toISOString(), "2026-09-21T16:00:00.000Z");
  assert.equal(a.summary, "Agents that run your workflows for you."); // tags and "appeared first on" removed
  assert.equal(b.title, "Second post with “quotes”");
  assert.equal(b.date, null); // bad date is null, not a crash
});

test("Atom: alternate link href and published date", () => {
  const [e] = feedItems(fixture("atom.xml"));
  assert.equal(e.title, "New model now available on AI Gateway");
  assert.equal(e.url, "https://vercel.com/changelog/new-model");
  assert.equal(e.date.toISOString(), "2026-09-22T09:30:00.000Z");
  assert.match(e.summary, /^You can now call/);
});

test("empty or broken input gives no items", () => {
  assert.deepEqual(feedItems(""), []);
  assert.deepEqual(feedItems("<html>not a feed</html>"), []);
});

test("text() strips tags and double-encoded entities; clip() cuts on a word", () => {
  assert.equal(text("<p>A &amp;amp; B</p> ,ok"), "A & B,ok");
  assert.equal(clip("one two three four five", 16), "one two three…");
  assert.equal(clip("short", 12), "short");
});
