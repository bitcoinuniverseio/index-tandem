/**
 * Social preview images, one per built page.
 *
 * Every glyph is converted to a vector path with fontkit before rasterising, so
 * the output does not depend on any font being installed. A Windows laptop and
 * an Ubuntu CI runner produce the same picture.
 *
 * Run after `astro build`. It reads the pages that were actually emitted, which
 * is the same set the pages themselves link to, so the two cannot drift.
 */
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIST = join(ROOT, "dist");
const OUT = join(DIST, "og");

const WIDTH = 1200;
const HEIGHT = 630;

const INK = "#0a0b0d";
const TEXT = "#f3f1ec";
const MUTED = "#a3a29a";
const FAINT = "#57575a";
const EMBER = "#f0954a";
const TIDE = "#56c7c0";

const serif = fontkit.openSync(
  join(ROOT, "node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff"),
);
const sans = fontkit.openSync(
  join(ROOT, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
);

/** Advance width of a string at a given size, in pixels. */
function measure(font, text, size) {
  const run = font.layout(text);
  return (run.advanceWidth / font.unitsPerEm) * size;
}

/** Convert a string to a single SVG path element with the baseline at y. */
function textPath(font, text, size, x, y, fill, opacity = 1) {
  const scale = size / font.unitsPerEm;
  const run = font.layout(text);
  let cursor = 0;
  const parts = [];
  for (const [index, glyph] of run.glyphs.entries()) {
    const position = run.positions[index];
    const path = glyph.path
      .scale(scale, -scale)
      .translate(x + cursor + (position.xOffset ?? 0) * scale, y);
    const d = path.toSVG();
    if (d) parts.push(d);
    cursor += (position.xAdvance ?? 0) * scale;
  }
  if (parts.length === 0) return "";
  return `<path d="${parts.join(" ")}" fill="${fill}" fill-opacity="${opacity}"/>`;
}

/** Greedy word wrap using real measured widths. */
function wrap(font, text, size, maxWidth, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(font, candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    const consumed = lines.join(" ").length;
    if (consumed < text.length - 1) {
      let trimmed = last;
      while (trimmed && measure(font, `${trimmed}…`, size) > maxWidth) {
        trimmed = trimmed.slice(0, -1).trimEnd();
      }
      lines[maxLines - 1] = `${trimmed}…`;
    }
  }
  return lines;
}

function buildSvg(title, description) {
  const pad = 80;
  const inner = WIDTH - pad * 2;

  // Scale the headline down when a title is long so it always fills well.
  const titleSize = title.length > 46 ? 62 : title.length > 28 ? 76 : 90;
  const titleLines = wrap(serif, title, titleSize, inner, 3);
  const descLines = description ? wrap(sans, description, 25, inner - 20, 2) : [];

  const lineStep = titleSize * 1.08;
  let y = 232 + titleSize * 0.74;
  const titleSvg = titleLines
    .map((line) => {
      const path = textPath(serif, line, titleSize, pad, y, TEXT);
      y += lineStep;
      return path;
    })
    .join("");

  let dy = 232 + titleLines.length * lineStep + 46;
  const descSvg = descLines
    .map((line) => {
      const path = textPath(sans, line, 24, pad, dy, MUTED);
      dy += 35;
      return path;
    })
    .join("");

  // The mark, drawn large and faint on the right: two independent uprights
  // crossed by one shared record.
  const watermark = `<g opacity="0.5">
    <rect x="1006" y="168" width="26" height="196" fill="${EMBER}" fill-opacity="0.22"/>
    <rect x="1074" y="216" width="26" height="196" fill="${TIDE}" fill-opacity="0.22"/>
    <rect x="988" y="278" width="130" height="10" fill="${TEXT}" fill-opacity="0.14"/>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${INK}"/>
  ${watermark}

  <g transform="translate(${pad} 62)">
    <rect x="0" y="0" width="7" height="24" fill="${EMBER}"/>
    <rect x="17" y="6" width="7" height="24" fill="${TIDE}"/>
    <rect x="-4" y="13" width="32" height="3" fill="${TEXT}"/>
  </g>
  ${textPath(serif, "Tandem", 30, pad + 44, 90, TEXT)}
  ${textPath(sans, "A Bitcoin object two people hold together", 17, pad + 158, 88, FAINT)}

  <rect x="${pad}" y="128" width="${inner}" height="1" fill="${TEXT}" fill-opacity="0.12"/>

  ${titleSvg}
  ${descSvg}

  <rect x="0" y="${HEIGHT - 8}" width="${WIDTH / 2}" height="8" fill="${EMBER}"/>
  <rect x="${WIDTH / 2}" y="${HEIGHT - 8}" width="${WIDTH / 2}" height="8" fill="${TIDE}"/>
</svg>`;
}

/** Same rule as `src/lib/og.ts`. */
function slugFor(relPath) {
  const route = relPath
    .split(sep)
    .join("/")
    .replace(/index\.html$/, "")
    .replace(/\.html$/, "")
    .replace(/\/$/, "");
  if (!route) return "index";
  return route.replace(/[^a-zA-Z0-9/_-]/g, "-").replace(/\//g, "__");
}

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "og" || entry.name === "pagefind" || entry.name === "_astro") continue;
      yield* htmlFiles(full);
    } else if (entry.name.endsWith(".html")) {
      yield full;
    }
  }
}

function extract(html) {
  const rawTitle = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "Tandem";
  const rawDesc =
    /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html)?.[1] ??
    /<meta\s+content="([^"]*)"\s+name="description"/i.exec(html)?.[1] ??
    "";
  const decode = (value) =>
    value
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .trim();
  return {
    title: decode(rawTitle).replace(/\s*·\s*Tandem$/, "").trim() || "Tandem",
    description: decode(rawDesc),
  };
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  let count = 0;
  for await (const file of htmlFiles(DIST)) {
    const rel = relative(DIST, file);
    const slug = slugFor(rel);
    const html = await readFile(file, "utf8");
    const { title, description } = extract(html);
    const png = await sharp(Buffer.from(buildSvg(title, description))).png({ compressionLevel: 9 }).toBuffer();
    await writeFile(join(OUT, `${slug}.png`), png);
    count += 1;
  }
  process.stdout.write(`social previews: ${count} images written to dist/og\n`);
}

await main();
