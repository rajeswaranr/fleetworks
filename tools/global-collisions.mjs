#!/usr/bin/env node
/* Finds top-level function names defined by more than one script loaded on the
   same page. In a browser the later script silently replaces the earlier one,
   which is how a stale module can break a feature it has nothing to do with
   (e.g. overview.controller.js replacing populateFilterDropdowns()).

     node tools/global-collisions.mjs [page.html ...]     default: every *.html
     node tools/global-collisions.mjs --strict            exit 1 on any collision */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let acorn;
try { acorn = require("acorn"); } catch { console.error("acorn is required: npm i --no-save acorn"); process.exit(2); }

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const pages = args.length ? args : readdirSync(ROOT).filter((f) => f.endsWith(".html"));
let total = 0;

for (const page of pages) {
  const html = readFileSync(join(ROOT, page), "utf8");
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const src = /src\s*=\s*["']([^"']+)["']/.exec(m[1]);
    if (src) { if (!/^https?:/.test(src[1])) scripts.push({ name: src[1].split("?")[0], code: null }); }
    else if (m[2].trim()) scripts.push({ name: `${page} (inline #${scripts.filter((s) => s.code !== null).length + 1})`, code: m[2] });
  }
  const seen = new Map();
  const found = [];
  for (const s of scripts) {
    let code = s.code;
    if (code === null) { try { code = readFileSync(join(ROOT, s.name), "utf8"); } catch { continue; } }
    let ast;
    try { ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true }); } catch { continue; }
    for (const n of ast.body) {
      if (n.type !== "FunctionDeclaration" || !n.id) continue;
      const prev = seen.get(n.id.name);
      if (prev && prev !== s.name) found.push(`${n.id.name}()  ${prev}  →  replaced by  ${s.name}`);
      seen.set(n.id.name, s.name);
    }
  }
  if (found.length) { console.log(`\n${page}`); found.forEach((f) => console.log("  " + f)); total += found.length; }
}
console.log(total ? `\n${total} colliding function name${total === 1 ? "" : "s"}.` : "No colliding top-level function names.");
if (process.argv.includes("--strict") && total) process.exit(1);
