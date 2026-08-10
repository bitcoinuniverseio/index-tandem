/**
 * Writing rules, enforced rather than hoped for.
 *
 * Three classes of failure:
 *   1. Em dashes and their lookalikes. Never allowed, anywhere.
 *   2. Marketing filler and the stock phrases that make writing read as
 *      machine generated.
 *   3. Version labelling. There is one Tandem, presented as the current thing.
 *
 * Run over the authored source, not the built output, so the message points at
 * a file you can actually edit.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(ROOT, "..");

const SCAN = [
  { dir: join(ROOT, "src"), exts: [".astro", ".mdx", ".md", ".ts", ".css"] },
  { dir: join(ROOT, "scripts"), exts: [".mjs"] },
  { dir: join(REPO, "docs"), exts: [".md"] },
];
const SINGLE = [join(REPO, "README.md")];

const SKIP_DIRS = new Set(["node_modules", "dist", ".astro", "og", "pagefind"]);

/**
 * Checked in every file, including code. These characters have no legitimate
 * use anywhere in this project.
 */
const UNIVERSAL = [
  { pattern: /—/g, why: "em dash. Rewrite the sentence or use a full stop." },
  { pattern: /―/g, why: "horizontal bar, reads as an em dash." },
  { pattern: /⸺|⸻/g, why: "long dash." },
];

/**
 * Checked in prose only. Code fences, CSS custom properties and command line
 * flags are skipped, because a double hyphen is meaningful there.
 */
const BANNED = [
  { pattern: /(?<=\S\s)--(?=\s\S)/g, why: "double hyphen standing in for an em dash." },

  { pattern: /\brevolutionary\b/gi, why: "empty claim." },
  { pattern: /\bcutting[- ]edge\b/gi, why: "empty claim." },
  { pattern: /\bseamless(ly)?\b/gi, why: "say what actually happens instead." },
  { pattern: /\bgame[- ]chang(er|ing)\b/gi, why: "empty claim." },
  { pattern: /\bnext[- ]generation\b/gi, why: "version labelling and an empty claim." },
  { pattern: /\bstate[- ]of[- ]the[- ]art\b/gi, why: "empty claim." },
  { pattern: /\bbest[- ]in[- ]class\b/gi, why: "empty claim." },
  { pattern: /\bworld[- ]class\b/gi, why: "empty claim." },
  { pattern: /\bpowerful and intuitive\b/gi, why: "stock phrase." },
  { pattern: /\btransform your workflow\b/gi, why: "stock phrase." },
  { pattern: /\bunlock the future\b/gi, why: "stock phrase." },
  { pattern: /\bharness the power\b/gi, why: "stock phrase." },
  { pattern: /\bsupercharge\b/gi, why: "stock phrase." },
  { pattern: /\belevate your\b/gi, why: "stock phrase." },
  { pattern: /\bdelve\b/gi, why: "reads as machine generated." },
  { pattern: /\bin today's fast[- ]paced\b/gi, why: "reads as machine generated." },
  { pattern: /\bit'?s worth noting\b/gi, why: "filler. State the thing." },
  { pattern: /\bat its core,/gi, why: "filler." },
  { pattern: /\bwhen it comes to\b/gi, why: "filler." },
  { pattern: /\bfurthermore,/gi, why: "essay filler." },
  { pattern: /\bmoreover,/gi, why: "essay filler." },
  { pattern: /\bin conclusion,/gi, why: "essay filler." },
  { pattern: /\bdive (deep )?into\b/gi, why: "stock phrase." },

  { pattern: /(?<![.\w-])v[12]\b/gi, why: "version labelling. There is one Tandem." },
  { pattern: /\blegacy\b/gi, why: "version labelling." },
  { pattern: /\bnew version\b/gi, why: "version labelling." },
  { pattern: /\bold version\b/gi, why: "version labelling." },
];

/** Prose lives in these. Everything else is only screened for em dashes. */
const PROSE_EXTS = new Set([".md", ".mdx", ".astro"]);

/** Lines that are code even inside a prose file. */
const CODE_LINE = [
  /^\s*(-{2,}|\/\/|\/\*|\*)/,
  /var\(--/,
  /^\s*--[a-z]/i,
  /^\s*(import|export|const|let|function|class|return|await)\b/,
  /npm |npx |docker |node |git |curl /,
  /^\s*[a-z-]+:\s*[^ ]+;\s*$/i,
];

async function* walk(dir, exts) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name), exts);
    } else if (exts.includes(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

async function collect() {
  const files = [...SINGLE];
  for (const target of SCAN) {
    for await (const file of walk(target.dir, target.exts)) files.push(file);
  }
  return files;
}

async function main() {
  const files = await collect();
  const problems = [];

  for (const file of files) {
    if (file.includes("check-prose")) continue;
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    const isProse = PROSE_EXTS.has(extname(file));
    let inFence = false;

    for (const [index, line] of lines.entries()) {
      const report = (match, why) =>
        problems.push({
          file: relative(REPO, file),
          line: index + 1,
          found: match,
          why,
          text: line.trim().slice(0, 110),
        });

      for (const rule of UNIVERSAL) {
        rule.pattern.lastIndex = 0;
        const match = rule.pattern.exec(line);
        if (match) report(match[0], rule.why);
      }

      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (!isProse || inFence) continue;
      if (CODE_LINE.some((rule) => rule.test(line))) continue;

      for (const rule of BANNED) {
        rule.pattern.lastIndex = 0;
        const match = rule.pattern.exec(line);
        if (match) report(match[0], rule.why);
      }
    }
  }

  if (problems.length > 0) {
    process.stderr.write(`\nProse check failed with ${problems.length} problem(s):\n\n`);
    for (const problem of problems) {
      process.stderr.write(
        `  ${problem.file}:${problem.line}\n    found "${problem.found}" - ${problem.why}\n    ${problem.text}\n\n`,
      );
    }
    process.exit(1);
  }

  process.stdout.write(`prose: ${files.length} files clean\n`);
}

await main();
