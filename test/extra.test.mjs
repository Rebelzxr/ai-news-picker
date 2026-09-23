import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { candidateStore, loadExtra } from "../src/collectors.mjs";
import { compileWords, loadConfig } from "../src/config.mjs";

test("--extra: generic items and trusted X posts become candidates", () => {
  const cfg = loadConfig();
  const { list, add } = candidateStore();
  const stats = [];
  loadExtra(fileURLToPath(new URL("../examples/extra-candidates.json", import.meta.url)), { cfg, re: compileWords(cfg.words), add, today: "2026-09-23", stats });
  assert.deepEqual(list.map((c) => c.section).sort(), ["community", "voices"]);
  const x = list.find((c) => c.section === "voices");
  assert.equal(x.source, "@claudeai");
  assert.equal(x.trusted, true);
  assert.equal(x.date, "2026-09-23");
  assert.deepEqual(stats, ["extra 2"]);
});

test("--extra: untrusted handles and non-official releases are ignored", () => {
  const cfg = loadConfig();
  const { list, add } = candidateStore();
  const stats = [];
  const file = fileURLToPath(new URL("./fixtures/extra-untrusted.json", import.meta.url));
  loadExtra(file, { cfg, re: compileWords(cfg.words), add, today: "2026-09-23", stats });
  assert.equal(list.length, 0);
});
