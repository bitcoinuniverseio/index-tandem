/**
 * Static endpoints that a documentation site is expected to serve, generated
 * from the built output rather than maintained by hand.
 *
 * Three of these were missing and returned 404 on the published site:
 *
 *   /llms.txt            a machine readable index of every page
 *   /sitemap.xml         the name crawlers try first, alongside the
 *                        sitemap-index.xml that the sitemap integration writes
 *   /docs.manifest.json  the repository documentation manifest, so the portal
 *                        and any other consumer can read it over HTTP
 *
 * robots.txt is a static file in public/ because it never changes.
 *
 * Run after `astro build`. Reads dist, writes dist, and fails loudly if the
 * build output is not there.
 */
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(ROOT, "..");
const DIST = join(ROOT, "dist");
const SITE = "https://bitcoinuniverseio.github.io";
const BASE = "/index-tandem";

/** Sidebar order, so llms.txt reads in the same order as the site. */
const SECTIONS = [
  ["discover", "Discover"],
  ["experience", "Experience"],
  ["build", "Build"],
  ["operate", "Operate"],
  ["understand", "Understand"],
  ["tools", "Tools"],
  ["participate", "Participate"],
];

const SKIP_DIRS = new Set(["pagefind", "_astro", "og"]);

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* htmlFiles(join(dir, entry.name));
    } else if (entry.name === "index.html") {
      yield join(dir, entry.name);
    }
  }
}

function routeOf(file) {
  const parts = relative(DIST, dirname(file)).split(sep).filter(Boolean);
  return parts.length === 0 ? `${BASE}/` : `${BASE}/${parts.join("/")}/`;
}

async function collectPages() {
  const pages = [];
  for await (const file of htmlFiles(DIST)) {
    const { document } = parseHTML(await readFile(file, "utf8"));
    const title = document.querySelector("title")?.textContent?.trim() ?? "";
    const description =
      document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
    pages.push({ route: routeOf(file), title: title.split(" · ")[0].trim(), description });
  }
  return pages.sort((left, right) => left.route.localeCompare(right.route));
}

function sectionOf(route) {
  const rest = route.slice(BASE.length + 1);
  return rest === "" ? "" : rest.split("/")[0];
}

async function writeLlmsTxt(pages) {
  const lines = [
    "# Tandem indexer pipeline A",
    "",
    "> Tandem is a Bitcoin object two people hold together. This site documents pipeline A,",
    "> the TypeScript, NestJS and MySQL indexer for it. The protocol itself is specified in a",
    "> separate repository, and a second, independent verifier is implemented in Rust.",
    "",
    "The protocol specification, JSON schemas and golden vectors are authoritative and live at",
    "https://bitcoinuniverseio.github.io/tandem/. Nothing on this site overrides them.",
    "",
    "This service exposes two HTTP surfaces. `/tandem` answers from this pipeline's own view.",
    "`/tandem/verified` refuses to answer unless this pipeline and an independently implemented",
    "pipeline B produce signed, trusted, matching agreement tuples at the same height.",
    "",
  ];
  const home = pages.find((page) => page.route === `${BASE}/`);
  if (home) {
    lines.push("## Start here", "", `- [${home.title}](${SITE}${home.route}): ${home.description}`, "");
  }
  for (const [slug, label] of SECTIONS) {
    const section = pages.filter((page) => sectionOf(page.route) === slug);
    if (section.length === 0) continue;
    lines.push(`## ${label}`, "");
    for (const page of section) {
      lines.push(`- [${page.title}](${SITE}${page.route}): ${page.description}`);
    }
    lines.push("");
  }
  lines.push(
    "## Related",
    "",
    "- [Tandem protocol](https://bitcoinuniverseio.github.io/tandem/): the normative specification, schemas and vectors.",
    "- [Indexer repository](https://github.com/bitcoinuniverseio/index-tandem): this service.",
    "- [Independent verifier](https://github.com/bitcoinuniverseio/tandem-verifier-rs): pipeline B, in Rust and PostgreSQL.",
    "- [Documentation manifest](https://bitcoinuniverseio.github.io/index-tandem/docs.manifest.json): machine readable repository metadata.",
    "",
  );
  await writeFile(join(DIST, "llms.txt"), lines.join("\n"), "utf8");
  return lines.length;
}

async function main() {
  const pages = await collectPages();
  if (pages.length === 0) {
    throw new Error("no built pages found in dist; run astro build first");
  }
  await writeLlmsTxt(pages);

  // The sitemap integration writes sitemap-index.xml. Crawlers and the
  // robots.txt convention ask for /sitemap.xml, so serve the index there too.
  await copyFile(join(DIST, "sitemap-index.xml"), join(DIST, "sitemap.xml"));

  // Serve the repository manifest over HTTP as well as from the repository.
  await copyFile(join(REPO, "docs.manifest.json"), join(DIST, "docs.manifest.json"));

  process.stdout.write(
    `static endpoints: llms.txt (${pages.length} pages), sitemap.xml, docs.manifest.json\n`,
  );
}

await main();
