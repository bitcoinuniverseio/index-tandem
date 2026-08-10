import { createRequire } from "node:module";
import { DocumentBuilder } from "@nestjs/swagger";

const packageJson = createRequire(import.meta.url)("../../package.json") as { version: string };

export const DOCS_SITE = "https://bitcoinuniverse.github.io/index-tandem/";

/** Reusable response fragments so the published contract stays consistent. */
export const VERIFICATION_SCHEMA = {
  type: "object",
  required: ["status", "height", "blockHash", "chainedRoot", "pipelineA", "pipelineB"],
  properties: {
    status: { type: "string", enum: ["verified"] },
    height: { type: "integer", description: "Canonical height both pipelines agreed on" },
    blockHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
    chainedRoot: { type: "string", pattern: "^[0-9a-f]{64}$" },
    pipelineA: { $ref: "#/components/schemas/PipelineIdentity" },
    pipelineB: { $ref: "#/components/schemas/PipelineIdentity" },
  },
} as const;

export const PIPELINE_IDENTITY_SCHEMA = {
  type: "object",
  required: ["keyId", "signature", "release"],
  properties: {
    keyId: { type: "string", description: "Must appear in the configured trust map" },
    signature: { type: "string", pattern: "^[0-9a-f]{128}$" },
    release: {
      type: "object",
      description:
        "Signed build identity. The two pipelines are expected to differ here and are not required to match.",
      required: ["parserCommit", "indexerCommit", "parserBinarySha256", "indexerBinarySha256"],
      properties: {
        parserCommit: { type: "string", pattern: "^[0-9a-f]{40}$" },
        indexerCommit: { type: "string", pattern: "^[0-9a-f]{40}$" },
        parserBinarySha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        indexerBinarySha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
      },
    },
  },
} as const;

export const VERIFICATION_UNAVAILABLE_SCHEMA = {
  type: "object",
  description:
    "Returned for every verification failure. The body is deliberately identical whichever check failed, so a caller cannot probe the gateway's internals. There is no statusCode field: the 503 is carried by the status line.",
  required: ["status", "error"],
  properties: {
    status: { type: "string", enum: ["verification_unavailable"] },
    error: { type: "string", enum: ["verification_unavailable"] },
  },
} as const;

export const AGREEMENT_ENVELOPE_SCHEMA = {
  type: "object",
  required: ["schema", "key_id", "tuple", "signature"],
  description:
    "Ed25519 signature over the RFC 8785 canonical JSON of the tuple. The envelope fields around the tuple are not covered by the signature.",
  properties: {
    schema: { type: "string", enum: ["urn:tandem:agreement-envelope"] },
    key_id: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" },
    signature: { type: "string", pattern: "^[0-9a-f]{128}$" },
    tuple: {
      type: "object",
      required: [
        "schema",
        "protocol_id",
        "height",
        "block_hash",
        "event_root",
        "object_state_root",
        "chained_root",
        "founding_created",
        "all_objects",
        "active_objects",
        "parser_commit",
        "indexer_commit",
        "parser_binary_sha256",
        "indexer_binary_sha256",
      ],
      properties: {
        schema: { type: "string", enum: ["urn:tandem:agreement-tuple"] },
        protocol_id: {
          type: "string",
          pattern: "^tndm:(mainnet|signet|testnet4|regtest):[0-9a-f]{64}$",
        },
        height: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
        block_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
        event_root: { type: "string", pattern: "^[0-9a-f]{64}$" },
        object_state_root: { type: "string", pattern: "^[0-9a-f]{64}$" },
        chained_root: { type: "string", pattern: "^[0-9a-f]{64}$" },
        founding_created: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
        all_objects: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
        active_objects: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
        parser_commit: { type: "string", pattern: "^[0-9a-f]{40}$" },
        indexer_commit: { type: "string", pattern: "^[0-9a-f]{40}$" },
        parser_binary_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        indexer_binary_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
      },
    },
  },
} as const;

const DESCRIPTION = [
  "Tandem is a Bitcoin object held jointly by exactly two keys. This service indexes one deployment of it and exposes two separate HTTP surfaces.",
  "",
  "`/tandem` is the direct surface. It answers from this pipeline's own view and makes no claim that any other implementation agrees.",
  "",
  "`/tandem/verified` is the fail-closed surface. Before returning any data it requires a signed agreement tuple from this pipeline and an independently signed tuple from pipeline B at the same canonical height, verifies both signatures against configured trust maps, and compares nine semantic fields. It verifies again after the read. If anything is missing, stale, untrusted, unverifiable, or different, it returns HTTP 503 rather than an answer it cannot stand behind.",
  "",
  "Pipeline A is not an authority for wallet spending. A missing, stale, or disagreeing tuple must block mint and protected-output spending flows.",
  "",
  "Mainnet responses on the verified surface are refused unless `TANDEM_VERIFIED_MAINNET_ENABLED=true` is set deliberately.",
].join("\n");

export function buildOpenApiConfig() {
  return new DocumentBuilder()
    .setTitle("Tandem indexer pipeline A")
    .setDescription(DESCRIPTION)
    .setVersion(packageJson.version)
    .setLicense("MIT", "https://github.com/bitcoinuniverse/index-tandem/blob/main/LICENSE")
    .setExternalDoc("Tandem documentation", DOCS_SITE)
    .addServer("http://127.0.0.1:3021", "Local pipeline A")
    .addTag("tandem", "This pipeline's own view of the deployment. No cross-implementation claim.")
    .addTag(
      "tandem-verified",
      "Explorer surface. Serves data only while two independent pipelines agree, and closes otherwise.",
    )
    .addTag("operations", "Liveness, readiness, and Prometheus metrics.")
    .build();
}

/** Schemas that are referenced by name from the route decorators. */
export const EXTRA_SCHEMAS = {
  PipelineIdentity: PIPELINE_IDENTITY_SCHEMA,
  Verification: VERIFICATION_SCHEMA,
  VerificationUnavailable: VERIFICATION_UNAVAILABLE_SCHEMA,
  AgreementEnvelope: AGREEMENT_ENVELOPE_SCHEMA,
} as const;

/**
 * Registers the shared schemas that route decorators reference by `$ref`.
 * Nest only auto-discovers decorated classes, and these are plain fragments.
 */
export function withExtraSchemas<T extends { components?: { schemas?: unknown } }>(document: T): T {
  if (!document.components) {
    document.components = {} as NonNullable<T["components"]>;
  }
  const components = document.components as { schemas?: Record<string, unknown> };
  components.schemas = { ...(components.schemas ?? {}), ...EXTRA_SCHEMAS };
  return document;
}
