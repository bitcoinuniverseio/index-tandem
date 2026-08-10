/**
 * Quotes frontmatter scalars that YAML would otherwise misread.
 *
 * A value containing ": " starts a mapping in YAML, so a description like
 * `The output that is the object: its script` fails to parse. This wraps such
 * values in double quotes and escapes any embedded ones.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "src", "content", "docs");

const SCALAR_KEYS = ["title", "description", "eyebrow", "takeaway"];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".mdx") || entry.name.endsWith(".md")) yield full;
  }
}

function needsQuoting(value) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^["'].*["']$/.test(trimmed)) return false;
  // A colon followed by a space, or a leading indicator character, breaks YAML.
  return /:\s/.test(trimmed) || /^[[\]{}>|*&!%@`#]/.test(trimmed);
}

const files = [];
for await (const file of walk(DOCS)) files.push(file);

let changed = 0;
const touched = [];

for (const file of files) {
  const text = await readFile(file, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) continue;

  const original = match[1];
  const lines = original.split(/\r?\n/);
  let dirty = false;

  const fixed = lines.map((line) => {
    const keyMatch = /^(\s*)([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!keyMatch) return line;
    const [, indent, key, value] = keyMatch;
    if (!SCALAR_KEYS.includes(key)) return line;
    if (!needsQuoting(value)) return line;
    dirty = true;
    return `${indent}${key}: "${value.trim().replace(/"/g, '\\"')}"`;
  });

  if (!dirty) continue;
  await writeFile(file, text.replace(original, fixed.join("\n")), "utf8");
  changed += 1;
  touched.push(relative(ROOT, file));
}

process.stdout.write(`frontmatter: quoted values in ${changed} of ${files.length} files\n`);
for (const file of touched) process.stdout.write(`  ${file}\n`);
