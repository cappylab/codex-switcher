import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const bannedGlyphs = ["↻", "⚡", "☀", "☾", "👤", "✕", "✓"];
const uiFiles = [
  "src/App.tsx",
  "src/components/AccountCard.tsx",
  "src/components/UsageBar.tsx",
];

const failures = [];
for (const file of uiFiles) {
  const contents = fs.readFileSync(path.join(root, file), "utf8");
  for (const glyph of bannedGlyphs) {
    if (contents.includes(glyph)) {
      failures.push(`${file} contains emoji glyph ${glyph}`);
    }
  }
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-switcher-ui-check-"));
execFileSync(
  "pnpm",
  [
    "exec",
    "tsc",
    "--target",
    "ES2022",
    "--module",
    "ES2022",
    "--moduleResolution",
    "bundler",
    "--outDir",
    outDir,
    "src/lib/accountOrdering.ts",
  ],
  { cwd: root, stdio: "inherit" },
);

const { sortAccountsForDisplay, isUsageExhausted } = await import(
  pathToFileURL(path.join(outDir, "lib/accountOrdering.js")).href
);

const available = {
  id: "available",
  name: "Available",
  usage: {
    primary_used_percent: 30,
    secondary_used_percent: 20,
    has_credits: true,
    unlimited_credits: false,
    error: null,
  },
};
const exhausted = {
  id: "exhausted",
  name: "Exhausted",
  usage: {
    primary_used_percent: 100,
    secondary_used_percent: 20,
    has_credits: true,
    unlimited_credits: false,
    error: null,
  },
};
const unknown = { id: "unknown", name: "Unknown", usage: undefined };
const errorLimited = {
  id: "error-limited",
  name: "Limit Error",
  usage: {
    primary_used_percent: null,
    secondary_used_percent: null,
    has_credits: null,
    unlimited_credits: null,
    error: "rate limit reached",
  },
};

if (!isUsageExhausted(exhausted.usage)) {
  failures.push("100% usage should be treated as exhausted");
}
if (!isUsageExhausted(errorLimited.usage)) {
  failures.push("rate-limit usage errors should be treated as exhausted");
}

const sorted = sortAccountsForDisplay(
  [exhausted, unknown, available, errorLimited],
  "remaining_desc",
);
const sortedIds = sorted.map((account) => account.id);
const expected = ["available", "unknown", "exhausted", "error-limited"];
if (JSON.stringify(sortedIds) !== JSON.stringify(expected)) {
  failures.push(`Expected account order ${expected.join(", ")}, got ${sortedIds.join(", ")}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
