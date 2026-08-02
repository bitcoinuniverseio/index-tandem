/**
 * One deterministic social preview image per page.
 *
 * The page renders a link to `/og/<slug>.png` and the post-build step walks the
 * same output directory and writes exactly those files, so the two sides cannot
 * drift apart.
 */
export function ogSlugFromPathname(pathname: string, base: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  let route = pathname;
  if (trimmedBase && route.startsWith(trimmedBase)) route = route.slice(trimmedBase.length);
  route = route.replace(/^\/+|\/+$/g, "");
  route = route.replace(/(^|\/)index\.html$/, "");
  route = route.replace(/\.html$/, "");
  if (!route) return "index";
  return route.replace(/[^a-zA-Z0-9/_-]/g, "-").replace(/\//g, "__");
}
