/**
 * Internal link checking over the built output.
 *
 * Catches the three ways a static site quietly breaks:
 *   1. A link to a route that was never built.
 *   2. A root-relative link that forgot the GitHub Pages base path.
 *   3. A fragment that points at an id no page contains.
 *
 * Also asserts that every page carries the social preview image it references,
 * because those are produced by a separate step.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const BASE = "/index-tandem";

const SKIP_DIRS = new Set(["pagefind", "_astro", "og"]);

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* htmlFiles(join(dir, entry.name));
    } else if (entry.name.endsWith(".html")) {
      yield join(dir, entry.name);
    }
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Map a site path such as /index-tandem/build/errors/ to a file in dist. */
function distPathFor(pathname) {
  let route = pathname;
  if (route.startsWith(BASE)) route = route.slice(BASE.length);
  route = route.replace(/^\/+/, "");
  if (route === "" ) return join(DIST, "index.html");
  if (route.endsWith("/")) return join(DIST, route, "index.html");
  return join(DIST, route);
}

async function main() {
  const pages = [];
  for await (const file of htmlFiles(DIST)) pages.push(file);

  const idsByPage = new Map();
  const parsed = new Map();

  for (const file of pages) {
    const html = await readFile(file, "utf8");
    const { document } = parseHTML(html);
    parsed.set(file, document);
    const ids = new Set();
    for (const node of document.querySelectorAll("[id]")) ids.add(node.getAttribute("id"));
    idsByPage.set(file, ids);
  }

  const problems = [];
  let checked = 0;

  for (const file of pages) {
    const document = parsed.get(file);
    const from = relative(DIST, file).split(sep).join("/");

    // Social preview image must exist.
    const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (og) {
      const name = og.split("/").pop();
      if (!(await exists(join(DIST, "og", name)))) {
        problems.push(`${from}: social preview image og/${name} was not generated`);
      }
    } else {
      problems.push(`${from}: no og:image meta tag`);
    }

    for (const anchor of document.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href") ?? "";
      if (
        !href ||
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("data:")
      ) {
        continue;
      }
      checked += 1;

      if (href.startsWith("#")) {
        const id = decodeURIComponent(href.slice(1));
        if (id && !idsByPage.get(file).has(id)) {
          problems.push(`${from}: fragment ${href} has no matching id on this page`);
        }
        continue;
      }

      if (!href.startsWith("/")) {
        problems.push(`${from}: relative link "${href}". Use a base-prefixed absolute path.`);
        continue;
      }

      if (!href.startsWith(`${BASE}/`) && href !== BASE) {
        problems.push(`${from}: link "${href}" is missing the ${BASE} base path`);
        continue;
      }

      const [pathname, fragment] = href.split("#");
      const target = distPathFor(pathname);
      if (!(await exists(target))) {
        problems.push(`${from}: link "${href}" points at a page that was not built`);
        continue;
      }
      if (fragment) {
        const ids = idsByPage.get(target);
        if (ids && !ids.has(decodeURIComponent(fragment))) {
          problems.push(`${from}: link "${href}" points at an id that does not exist`);
        }
      }
    }
  }

  if (problems.length > 0) {
    process.stderr.write(`\nLink check failed with ${problems.length} problem(s):\n\n`);
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    process.stderr.write("\n");
    process.exit(1);
  }

  process.stdout.write(`links: ${checked} internal links across ${pages.length} pages all resolve\n`);
}

await main();
