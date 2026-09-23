// Loads config.json (the bundled default) and merges a user config on top.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_CONFIG_PATH = fileURLToPath(new URL("../config.json", import.meta.url));

export function loadConfig(file) {
  const base = JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, "utf8"));
  if (!file) return base;
  const user = JSON.parse(readFileSync(file, "utf8"));
  const merged = { ...base, ...user };
  // One level deep for the grouped settings, so a user file can change one key.
  for (const k of ["sectionCaps", "sectionBase", "hackerNews", "github", "words", "webhook"]) {
    merged[k] = { ...base[k], ...(user[k] || {}) };
  }
  return merged;
}

// Word lists are regex fragments. ai, fit, launch and noise match whole words;
// hype fragments match anywhere (they include emoji and digit patterns).
export function compileWords(words) {
  const whole = (list, flags) => new RegExp(`\\b(${list.join("|")})\\b`, flags);
  return {
    AI: whole(words.ai, "i"),
    FIT: whole(words.fit, "gi"),
    LAUNCH: whole(words.launch, "i"),
    NOISE: whole(words.noise, "i"),
    HYPE: new RegExp(words.hype.join("|"), "i"),
  };
}
