import { test } from "node:test";
import assert from "node:assert/strict";
import { officialUrl, validateDigest, validateNewsItem } from "../src/rules.mjs";

const good = {
  section: "releases", url: "https://openai.com/index/x", title: "A good enough title",
  source: "OpenAI", date: "2026-09-23", summary: "A summary that is long enough to pass the check.", tools: ["chatgpt"],
};

test("officialUrl: https only, listed domains and their subdomains", () => {
  assert.equal(officialUrl("https://openai.com/x"), true);
  assert.equal(officialUrl("https://blog.cloudflare.com/x"), true);
  assert.equal(officialUrl("http://openai.com/x"), false);
  assert.equal(officialUrl("https://notopenai.com/x"), false);
  assert.equal(officialUrl("not a url"), false);
  assert.equal(officialUrl("https://example.com/x", ["example.com"]), true);
});

test("validateNewsItem accepts a good item and defaults section", () => {
  assert.equal(validateNewsItem(good).section, "releases");
  const { section, ...noSection } = good;
  assert.equal(validateNewsItem(noSection).section, "releases");
});

test("validateNewsItem rejects each broken field", () => {
  const bad = [
    { section: "gossip" }, { title: "short" }, { url: "https://example.com/not-official" },
    { source: "" }, { date: "23/09/2026" }, { summary: "too short" }, { tools: ["notatool"] },
  ];
  for (const b of bad) assert.throws(() => validateNewsItem({ ...good, ...b }), undefined, JSON.stringify(b));
  assert.doesNotThrow(() => validateNewsItem({ ...good, section: "community", url: "https://example.com/story" }));
  assert.throws(() => validateNewsItem({ ...good, section: "community", url: "http://example.com/story" }));
});

test("validateDigest checks date, item count and duplicate urls", () => {
  assert.equal(validateDigest({ date: "2026-09-23", items: [good] }).items.length, 1);
  assert.throws(() => validateDigest({ date: "2026-09-23", items: [] }), /1-20 items/);
  assert.throws(() => validateDigest({ date: "today", items: [good] }), /date/);
  assert.throws(() => validateDigest({ date: "2026-09-23", items: [good, good] }), /duplicate url/);
  assert.throws(() => validateDigest(null), /not an object/);
});
