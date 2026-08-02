/**
 * A faithful port of the checks the verified gateway runs on an agreement
 * envelope, so the inspector on this site reaches the same verdict the service
 * would.
 *
 * Ported from:
 *   src/verification/verified-gateway.service.ts  (shape checks, exact key sets)
 *   src/agreement/agreement.service.ts            (field validation)
 *
 * The one thing this cannot do is verify the Ed25519 signature, because that
 * needs the trusted public key for the key id and those live only in an
 * operator's configuration. The inspector says so rather than guessing.
 */

export const ENVELOPE_KEYS = ["schema", "key_id", "tuple", "signature"] as const;

export const TUPLE_KEYS = [
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
] as const;

/** The nine fields both pipelines must agree on, in the order the code checks them. */
export const SEMANTIC_FIELDS = [
  "protocol_id",
  "height",
  "block_hash",
  "event_root",
  "object_state_root",
  "chained_root",
  "founding_created",
  "all_objects",
  "active_objects",
] as const;

/** The four fields deliberately left out of the comparison. */
export const RELEASE_FIELDS = [
  "parser_commit",
  "indexer_commit",
  "parser_binary_sha256",
  "indexer_binary_sha256",
] as const;

export const ENVELOPE_SCHEMA = "urn:tandem:agreement-envelope";
export const TUPLE_SCHEMA = "urn:tandem:agreement-tuple";

export const MAX_RESPONSE_BYTES = 65_536;

const HASH_HEX = /^[0-9a-f]{64}$/;
const COMMIT_HEX = /^[0-9a-f]{40}$/;
const COUNTER = /^(0|[1-9][0-9]*)$/;
const KEY_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SIGNATURE = /^[0-9a-f]{128}$/;
const PROTOCOL_ID = /^tndm:(mainnet|signet|testnet4|regtest):[0-9a-f]{64}$/;

export interface FieldRule {
  field: string;
  rule: RegExp;
  human: string;
  compared: boolean;
}

export const TUPLE_RULES: FieldRule[] = [
  {
    field: "protocol_id",
    rule: PROTOCOL_ID,
    human: "tndm, then the network label, then the configured INIT txid",
    compared: true,
  },
  { field: "height", rule: COUNTER, human: "a decimal string, no leading zero", compared: true },
  { field: "block_hash", rule: HASH_HEX, human: "64 lowercase hex characters", compared: true },
  { field: "event_root", rule: HASH_HEX, human: "64 lowercase hex characters", compared: true },
  {
    field: "object_state_root",
    rule: HASH_HEX,
    human: "64 lowercase hex characters",
    compared: true,
  },
  { field: "chained_root", rule: HASH_HEX, human: "64 lowercase hex characters", compared: true },
  { field: "founding_created", rule: COUNTER, human: "a decimal string", compared: true },
  { field: "all_objects", rule: COUNTER, human: "a decimal string", compared: true },
  { field: "active_objects", rule: COUNTER, human: "a decimal string", compared: true },
  { field: "parser_commit", rule: COMMIT_HEX, human: "40 lowercase hex characters", compared: false },
  {
    field: "indexer_commit",
    rule: COMMIT_HEX,
    human: "40 lowercase hex characters",
    compared: false,
  },
  {
    field: "parser_binary_sha256",
    rule: HASH_HEX,
    human: "64 lowercase hex characters",
    compared: false,
  },
  {
    field: "indexer_binary_sha256",
    rule: HASH_HEX,
    human: "64 lowercase hex characters",
    compared: false,
  },
];

export interface Finding {
  stage: "parse" | "envelope shape" | "tuple shape" | "tuple fields" | "signature";
  ok: boolean;
  message: string;
}

export interface InspectionResult {
  findings: Finding[];
  /** The gateway stops at the first failure, so this is the one it would report. */
  firstFailure: Finding | null;
  fieldStatus: { field: string; value: string; ok: boolean; compared: boolean; human: string }[];
}

function exactKeys(value: unknown, keys: readonly string[]): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "must be an object";
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    const missing = expected.filter((key) => !actual.includes(key));
    const extra = actual.filter((key) => !expected.includes(key));
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
    if (extra.length > 0) parts.push(`unexpected ${extra.join(", ")}`);
    return `has an invalid shape: ${parts.join(" and ")}`;
  }
  return null;
}

export function inspectEnvelope(raw: string): InspectionResult {
  const findings: Finding[] = [];
  const fieldStatus: InspectionResult["fieldStatus"] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    findings.push({ stage: "parse", ok: true, message: "Parsed as JSON." });
  } catch (error) {
    findings.push({
      stage: "parse",
      ok: false,
      message: `Not valid JSON: ${error instanceof Error ? error.message : "unknown error"}`,
    });
    return { findings, firstFailure: findings[0] ?? null, fieldStatus };
  }

  const envelopeShape = exactKeys(parsed, ENVELOPE_KEYS);
  if (envelopeShape) {
    findings.push({ stage: "envelope shape", ok: false, message: `agreement envelope ${envelopeShape}` });
    return { findings, firstFailure: findings.at(-1) ?? null, fieldStatus };
  }
  findings.push({
    stage: "envelope shape",
    ok: true,
    message: "Exactly the four expected envelope keys, no more and no fewer.",
  });

  const envelope = parsed as Record<string, unknown>;

  const tupleShape = exactKeys(envelope.tuple, TUPLE_KEYS);
  if (tupleShape) {
    findings.push({ stage: "tuple shape", ok: false, message: `agreement tuple ${tupleShape}` });
    return { findings, firstFailure: findings.at(-1) ?? null, fieldStatus };
  }
  findings.push({
    stage: "tuple shape",
    ok: true,
    message: "Exactly the fourteen expected tuple keys.",
  });

  const tuple = envelope.tuple as Record<string, unknown>;

  // Every tuple field has to be a string before any pattern is applied.
  for (const key of TUPLE_KEYS) {
    if (typeof tuple[key] !== "string") {
      findings.push({
        stage: "tuple fields",
        ok: false,
        message: `${key} must be a string. A JSON number is rejected even when the digits are right.`,
      });
      return { findings, firstFailure: findings.at(-1) ?? null, fieldStatus };
    }
  }

  if (tuple.schema !== TUPLE_SCHEMA) {
    findings.push({
      stage: "tuple fields",
      ok: false,
      message: `invalid agreement tuple schema. Expected ${TUPLE_SCHEMA}.`,
    });
    return { findings, firstFailure: findings.at(-1) ?? null, fieldStatus };
  }

  let firstFieldFailure: Finding | null = null;
  for (const rule of TUPLE_RULES) {
    const value = String(tuple[rule.field]);
    const ok = rule.rule.test(value);
    fieldStatus.push({
      field: rule.field,
      value,
      ok,
      compared: rule.compared,
      human: rule.human,
    });
    if (!ok && !firstFieldFailure) {
      firstFieldFailure = {
        stage: "tuple fields",
        ok: false,
        message: `invalid agreement ${rule.field}. Expected ${rule.human}.`,
      };
    }
  }

  const height = Number(tuple.height);
  if (!firstFieldFailure && (!Number.isSafeInteger(height) || height < 0)) {
    firstFieldFailure = {
      stage: "tuple fields",
      ok: false,
      message: "agreement height is unsafe. It has to be a non-negative safe integer.",
    };
  }

  if (firstFieldFailure) {
    findings.push(firstFieldFailure);
    return { findings, firstFailure: firstFieldFailure, fieldStatus };
  }
  findings.push({
    stage: "tuple fields",
    ok: true,
    message: "Every tuple field matches its required pattern.",
  });

  if (envelope.schema !== ENVELOPE_SCHEMA) {
    const finding: Finding = {
      stage: "signature",
      ok: false,
      message: `envelope schema is not supported. Expected ${ENVELOPE_SCHEMA}.`,
    };
    findings.push(finding);
    return { findings, firstFailure: finding, fieldStatus };
  }

  if (!KEY_ID.test(String(envelope.key_id))) {
    const finding: Finding = {
      stage: "signature",
      ok: false,
      message: "key_id uses characters outside the permitted set.",
    };
    findings.push(finding);
    return { findings, firstFailure: finding, fieldStatus };
  }

  if (!SIGNATURE.test(String(envelope.signature))) {
    const finding: Finding = {
      stage: "signature",
      ok: false,
      message: "signature must be exactly 128 lowercase hex characters.",
    };
    findings.push(finding);
    return { findings, firstFailure: finding, fieldStatus };
  }

  findings.push({
    stage: "signature",
    ok: true,
    message:
      "Well formed. Whether it verifies depends on the trusted public key for this key id, which only the operator's configuration holds.",
  });

  return { findings, firstFailure: null, fieldStatus };
}

/** Compares two tuples exactly the way `establishVerifiedAgreement` does. */
export function compareTuples(
  a: Record<string, string>,
  b: Record<string, string>,
): { field: string; a: string; b: string; match: boolean }[] {
  return SEMANTIC_FIELDS.map((field) => ({
    field,
    a: a[field] ?? "",
    b: b[field] ?? "",
    match: a[field] === b[field],
  }));
}
