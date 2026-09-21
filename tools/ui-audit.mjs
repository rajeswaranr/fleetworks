#!/usr/bin/env node
/* UI consistency audit. Scans the app's HTML and JS for UI that bypasses the
   framework (css/design-system.css + js/icons.js + js/window-controls.js) and
   prints counts per category with the worst files.

     node tools/ui-audit.mjs            summary
     node tools/ui-audit.mjs --files    every offending file per category
     node tools/ui-audit.mjs --strict   exit 1 if any category is over its budget

   Budgets live in tools/ui-audit.budget.json and only ever go down: the point
   is that new code cannot make the app less consistent than it is today. */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SKIP_DIRS = new Set(["node_modules", ".git", "supabase", "tools", "tests", "server", "android", "simulators", "icons", "assets", "docs", "db"]);
const SKIP_FILES = /(^|[\\/])(design-system|themes|landing|style)\.css$|(^|[\\/])(icons|control-guard|window-controls|dialogs)\.js$|test-data|testdata/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if ([".html", ".js"].includes(extname(p)) && !SKIP_FILES.test(p)) out.push(p);
  }
  return out;
}

// Emoji used as UI icons instead of FWIcon()/data-icon. Excludes plain
// punctuation-like symbols (arrows, ticks, rupee) and text-style marks.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;

const CHECKS = {
  "Emoji used as icons": (t) => count(t, new RegExp(EMOJI.source, "gu")),
  "Bare <button> (no .btn / .link-btn / framework class)": (t) =>
    [...t.matchAll(/<button\b([^>]*)>/g)].filter((m) => !/class\s*=\s*["'][^"']*(btn|link-btn|tab-btn|side-|settings-tile|fw-|chip|pill|toggle|close|nav|qa-|hub|drv-|role|cp-|mk-|ai-|fv-|fx-|gp-|sc-|lw-)/.test(m[1])).length,
  "Buttons styled inline (background/color/padding in style=)": (t) =>
    [...t.matchAll(/<button\b[^>]*style\s*=\s*["'][^"']*(background|padding|border)[^"']*["']/g)].length,
  "Ad-hoc dialog overlays (inline position:fixed;inset:0)": (t) => count(t, /position:\s*fixed;\s*inset:\s*0/g),
  "Inputs/selects styled inline (border/padding/background)": (t) =>
    [...t.matchAll(/<(input|select|textarea)\b[^>]*style\s*=\s*["'][^"']*(border|padding|background)[^"']*["']/g)].length,
  "Inline layout (display:flex|grid in style=)": (t) => count(t, /style\s*=\s*["'][^"']*display:\s*(flex|grid)/g),
  "Hard-coded colours in style= (#hex)": (t) => count(t, /style\s*=\s*["'][^"']*#[0-9a-fA-F]{3,6}\b/g),
  "Native confirm() (unstyled, no window controls — use await FWDialog.confirm)": (t) => count(t, /(^|[^.\w])confirm\(/g),
};

function count(t, re) { return (t.match(re) || []).length; }

const files = walk(ROOT);
const result = Object.fromEntries(Object.keys(CHECKS).map((k) => [k, { total: 0, files: {} }]));
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const [name, fn] of Object.entries(CHECKS)) {
    const n = fn(text);
    if (n) { result[name].total += n; result[name].files[relative(ROOT, f)] = n; }
  }
}

const budgetPath = join(ROOT, "tools", "ui-audit.budget.json");
const budget = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, "utf8")) : null;
const showFiles = process.argv.includes("--files");
let over = 0;

console.log(`UI audit — ${files.length} files scanned\n`);
for (const [name, r] of Object.entries(result)) {
  const cap = budget?.[name];
  const flag = cap != null && r.total > cap ? `  OVER BUDGET (max ${cap})` : cap != null ? `  (budget ${cap})` : "";
  if (cap != null && r.total > cap) over++;
  console.log(`${String(r.total).padStart(6)}  ${name}${flag}`);
  const worst = Object.entries(r.files).sort((a, b) => b[1] - a[1]);
  (showFiles ? worst : worst.slice(0, 3)).forEach(([f, n]) => console.log(`          ${String(n).padStart(5)}  ${f}`));
}

if (process.argv.includes("--write-budget")) {
  writeFileSync(budgetPath, JSON.stringify(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.total])), null, 2) + "\n");
  console.log("\nWrote", relative(ROOT, budgetPath));
}
if (process.argv.includes("--strict") && over) { console.error(`\n${over} categor${over === 1 ? "y is" : "ies are"} over budget.`); process.exit(1); }
