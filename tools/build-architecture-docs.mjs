import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "docs", "fleetworks-architecture-design.md");
const output = path.join(root, "docs", "fleetworks-architecture-design.html");

const escapeHtml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function inline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function isTableDivider(line) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((v) => v.trim());
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const out = [];
  let paragraph = [];
  let list = null;
  let inCode = false;
  let code = [];

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushParagraph(); closeList();
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = []; inCode = false;
      } else inCode = true;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph(); closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (line.startsWith("> ")) {
      flushParagraph(); closeList();
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushParagraph(); closeList();
      const headers = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(cells(lines[i])); i++;
      }
      i--;
      out.push("<table><thead><tr>" + headers.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
      rows.forEach((row) => out.push("<tr>" + row.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>"));
      out.push("</tbody></table>");
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const wanted = bullet ? "ul" : "ol";
      if (list !== wanted) { closeList(); out.push(`<${wanted}>`); list = wanted; }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph(); closeList();
  if (inCode) out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return out.join("\n");
}

const markdown = fs.readFileSync(source, "utf8");
const body = markdownToHtml(markdown);
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FleetWorks Application Architecture Design</title>
  <style>
    @page { size: Letter; margin: 0.72in; }
    * { box-sizing: border-box; }
    body { max-width: 960px; margin: 36px auto; padding: 0 28px; color: #172033; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.42; }
    h1, h2, h3 { color: #000; page-break-after: avoid; }
    h1 { margin: 0 0 18px; font-size: 25pt; font-weight: 700; }
    h2 { margin: 0 0 10px; font-size: 17pt; page-break-before: always; break-before: page; }
    h3 { margin: 20px 0 8px; font-size: 13pt; }
    p { margin: 0 0 10px; }
    ul, ol { margin: 4px 0 12px 24px; padding: 0; }
    li { margin: 0 0 4px; }
    code { font-family: Consolas, "Courier New", monospace; font-size: 0.92em; background: #f2f5f8; padding: 1px 3px; }
    pre { margin: 8px 0 12px; padding: 8px; border: 1px solid #d9d9d9; background: #f7f9fb; white-space: pre-wrap; overflow-wrap: anywhere; font-family: Consolas, "Courier New", monospace; font-size: 5pt; line-height: 5pt; page-break-inside: avoid; break-inside: avoid-page; }
    pre code { padding: 0; background: transparent; }
    blockquote { margin: 12px 0 16px; padding-left: 14px; border-left: 3px solid #66778a; color: #2f3c4d; }
    table { width: 100%; margin: 10px 0 18px; border-collapse: collapse; page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    th, td { border: 1px solid #d9d9d9; padding: 7px 8px; vertical-align: middle; text-align: left; }
    th { color: #fff; background: #22364f; font-weight: 700; }
    tbody tr:nth-child(even) { background: #f3f6fa; }
    @media print { body { max-width: none; margin: 0; padding: 0; } }
  </style>
</head>
<body>
${body}
</body>
</html>
`;

fs.writeFileSync(output, html);
console.log(`Wrote ${path.relative(root, output)}`);
