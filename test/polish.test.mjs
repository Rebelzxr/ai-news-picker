import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPolish, polishWithCommand } from "../src/polish.mjs";

const list = [
  { section: "releases", url: "https://openai.com/index/x", title: "Introducing Example 2 for teams", source: "OpenAI", date: "2026-09-23", summary: "Example 2 helps teams write reports 3 times faster than before.", tools: ["chatgpt"] },
  { section: "repos", url: "https://github.com/a/b", title: "a/b", source: "GitHub", date: "2026-09-23", summary: "A small tool that turns invoices into rows. (1,200 stars on GitHub.)", tools: ["open-source"] },
];
const node = JSON.stringify(process.execPath);
// A polish command that reads stdin and prints the given JSON (kept in a temp file).
const cmd = (out) => {
  const f = join(mkdtempSync(join(tmpdir(), "polish-test-")), "out.json");
  writeFileSync(f, JSON.stringify(out));
  return `${node} -e "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8')))" ${JSON.stringify(f)}`;
};

test("a failing command keeps the plain list", () => {
  const logs = [];
  const out = polishWithCommand(list, `${node} -e "process.exit(3)"`, { log: (m) => logs.push(m) });
  assert.deepEqual(out, list);
  assert.match(logs[0], /polish skipped.*exit 3/);
});

test("a missing command keeps the plain list", () => {
  assert.deepEqual(polishWithCommand(list, "definitely-not-a-real-command-xyz"), list);
});

test("non-JSON output keeps the plain list", () => {
  const logs = [];
  assert.deepEqual(polishWithCommand(list, `${node} -e "console.log('hello')"`, { log: (m) => logs.push(m) }), list);
  assert.match(logs[0], /polish skipped/);
});

test("a valid rewrite is applied through a real command", () => {
  const out = polishWithCommand(list, cmd({ items: [{ i: 0, title: "Example 2 is out for teams", summary: "Example 2 helps teams write reports faster than before." }] }));
  assert.equal(out[0].title, "Example 2 is out for teams");
  assert.deepEqual(out[1], list[1]);
});

test("rewrites with new numbers, bad lengths or invalid fields are refused one by one", () => {
  const { items, changed } = applyPolish(list, [
    { i: 0, title: "Example 2 makes reports 10 times faster", summary: "Example 2 helps teams write reports much faster than before." }, // 10 is new
    { i: 1, title: "x".repeat(130), summary: "A small tool that turns invoices into rows for you." },            // title too long
  ]);
  assert.equal(changed, 0);
  assert.deepEqual(items, list);
  assert.deepEqual(applyPolish(list, null).items, list);
  assert.deepEqual(applyPolish(list, [{ i: 0, title: "short", summary: "tiny" }]).items, list);
});

// Review cases for the number and hype guard.
const src = [{ section: "community", url: "https://example.com/enigma", title: "Model breaks Enigma message unsolved since 2005", source: "Hacker News", date: "2026-09-23", summary: "A model broke a message that resisted solution since 2005. On Hacker News with 687 points and 404 comments.", tools: ["other"] }];
const one = (title, summary) => applyPolish(src, [{ i: 0, title, summary }]);

test("guard: '$68 million' is refused even though '687' is in the source", () => {
  assert.equal(one("Lab spends $68 million to break Enigma", "A model broke a message that resisted solution since 2005.").changed, 0);
});

test("guard: '200x faster' is refused even though '2005' is in the source", () => {
  assert.equal(one("Model is 200x faster at breaking Enigma", "A model broke a message that resisted solution since 2005.").changed, 0);
});

test("guard: added number words are refused", () => {
  assert.equal(one("Model breaks Enigma for ten million users", "A model broke a message that resisted solution since 2005.").changed, 0);
  assert.equal(one("Model breaks old Enigma message", "It worked 10x better than anything since 2005.").changed, 0);
});

test("guard: added hype words or emoji are refused", () => {
  assert.equal(one("Insane: model breaks old Enigma message", "A model broke a message that resisted solution since 2005.").changed, 0);
  assert.equal(one("Model breaks old Enigma message 🤯", "A model broke a message that resisted solution since 2005.").changed, 0);
});

test("guard: a clean rewrite with the same numbers is accepted, trailing punctuation included", () => {
  const r = one("An AI model cracks an Enigma message from 2005", "The message had stayed unsolved since 2005. It drew 687 points and 404 comments on Hacker News.");
  assert.equal(r.changed, 1);
  assert.equal(r.items[0].title, "An AI model cracks an Enigma message from 2005");
});

test("guard: tens, -fold and dozens number words are refused", () => {
  const plain = "A model broke a message that resisted solution since 2005.";
  assert.equal(one("Sixty researchers watch a model break Enigma", plain).changed, 0);
  assert.equal(one("Ninety teams watch a model break Enigma", plain).changed, 0);
  assert.equal(one("Model breaks Enigma tenfold quicker", plain).changed, 0);
  assert.equal(one("Model breaks Enigma 3-fold quicker", plain).changed, 0);
  assert.equal(one("Dozens of labs watch a model break Enigma", plain).changed, 0);
  assert.equal(one("A new scaffold helps a model break Enigma", plain).changed, 1); // plain words ending in "fold" are fine
});
