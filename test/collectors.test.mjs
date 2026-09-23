import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { articleMatchesDate, candidateStore } from "../src/collectors.mjs";

test("dedupe: an official release replaces a Hacker News copy of the same URL and keeps the higher momentum", () => {
  const { list, add } = candidateStore();
  const url = "https://www.anthropic.com/news/example-model";
  add({ section: "community", url, title: "Introducing Example Model", source: "Hacker News", momentum: 0.9, points: 800 });
  add({ section: "releases", url, title: "Introducing Example Model", source: "Anthropic", core: true });
  assert.equal(list.length, 1);
  assert.equal(list[0].section, "releases");
  assert.equal(list[0].source, "Anthropic");
  assert.equal(list[0].momentum, 0.9);
});

test("dedupe: release first, Hacker News copy later: the release stays and keeps the higher momentum", () => {
  const { list, add } = candidateStore();
  const url = "https://www.anthropic.com/news/example-model";
  add({ section: "releases", url, title: "Introducing Example Model", source: "Anthropic", core: true });
  add({ section: "community", url, title: "Introducing Example Model", source: "Hacker News", momentum: 0.9 });
  assert.equal(list.length, 1);
  assert.equal(list[0].section, "releases");
  assert.equal(list[0].momentum, 0.9);
});

test("dedupe: other duplicates keep the first candidate", () => {
  const { list, add } = candidateStore();
  const url = "https://openai.com/index/x";
  add({ section: "releases", url, title: "First official copy", source: "OpenAI", momentum: 0.1 });
  add({ section: "releases", url, title: "Second copy", source: "Other", momentum: 1 });
  add({ section: "community", url, title: "HN copy", source: "Hacker News", momentum: 1 });
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "First official copy");
  assert.equal(list[0].momentum, 1); // still the higher momentum of the copies
});

test("page reader: the article's own first date must match, not a related-post date later on", () => {
  const html = readFileSync(new URL("./fixtures/article-related-date.html", import.meta.url), "utf8");
  assert.equal(articleMatchesDate(html, "Sep 22, 2026"), false);        // only in the related-post link
  assert.equal(articleMatchesDate(html, "September 18, 2026"), true);   // same day, long month name
  assert.equal(articleMatchesDate(html, "Sept 18, 2026"), true);
  assert.equal(articleMatchesDate("<p>no dates here</p>", "Sep 18, 2026"), false);
});
