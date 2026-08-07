import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The documentation site renders its API reference from this generated file.
 * These assertions fail if a route is added, removed, or renamed without
 * regenerating it with `npm run openapi:emit`.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface OpenApiDocument {
  info: { title: string; version: string; description: string };
  tags: { name: string }[];
  paths: Record<string, Record<string, { responses: Record<string, unknown>; tags?: string[] }>>;
  components: { schemas: Record<string, unknown> };
}

function loadDocument(): OpenApiDocument {
  const path = resolve(ROOT, "site/src/data/openapi.json");
  return JSON.parse(readFileSync(path, "utf8")) as OpenApiDocument;
}

const OPERATIONS = ["/health", "/ready", "/metrics"];

const DIRECT = [
  "/tandem/status",
  "/tandem/readiness",
  "/tandem/objects/{objectKey}",
  "/tandem/carriers/{txid}/{vout}",
  "/tandem/events/{txid}",
  "/tandem/invalid-events",
  "/tandem/reorgs",
  "/tandem/stats",
  "/tandem/agreement/{height}",
];

const VERIFIED = [
  "/tandem/verified/status",
  "/tandem/verified/objects",
  "/tandem/verified/objects/{key}",
  "/tandem/verified/events/{txid}",
  "/tandem/verified/transactions/{txid}",
  "/tandem/verified/addresses/{address}",
  "/tandem/verified/invalid-events",
  "/tandem/verified/mempool",
  "/tandem/verified/conflicts",
  "/tandem/verified/reorgs",
  "/tandem/verified/stats",
  "/tandem/verified/search",
];

describe("generated OpenAPI document", () => {
  const document = loadDocument();

  it("matches the package version and declares every tag", () => {
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    expect(document.info.version).toBe(packageJson.version);
    expect(document.info.title).toBe("Tandem indexer pipeline A");
    expect(document.tags.map((tag) => tag.name).sort()).toEqual([
      "operations",
      "tandem",
      "tandem-verified",
    ]);
  });

  it("publishes exactly the routes the controllers expose", () => {
    expect(Object.keys(document.paths).sort()).toEqual(
      [...OPERATIONS, ...DIRECT, ...VERIFIED].sort(),
    );
  });

  it("documents the fail-closed contract on every verified route", () => {
    for (const route of VERIFIED) {
      const operation = document.paths[route]?.get;
      expect(operation, `${route} must expose GET`).toBeDefined();
      expect(Object.keys(operation?.responses ?? {}), `${route} must document 503`).toContain(
        "503",
      );
      expect(operation?.tags).toContain("tandem-verified");
    }
  });

  it("exposes only read routes", () => {
    for (const [route, methods] of Object.entries(document.paths)) {
      expect(Object.keys(methods), `${route} must be read only`).toEqual(["get"]);
    }
  });

  it("registers the shared response schemas the routes reference", () => {
    expect(Object.keys(document.components.schemas).sort()).toEqual([
      "AgreementEnvelope",
      "PipelineIdentity",
      "Verification",
      "VerificationUnavailable",
    ]);
  });

  it("states the mainnet gate and the spending boundary in the published description", () => {
    expect(document.info.description).toContain("TANDEM_VERIFIED_MAINNET_ENABLED=true");
    expect(document.info.description).toContain("not an authority for wallet spending");
  });
});
