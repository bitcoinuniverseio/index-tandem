import { Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  type AgreementTuple,
  assertAgreementTuple,
  type ReleaseIdentity,
  type SignedAgreementEnvelope,
  verifyAgreementEnvelope,
} from "../agreement/agreement.service.js";
import { AgreementQueryService } from "../agreement/agreement-query.service.js";
import type { AppConfiguration } from "../config/configuration.js";
import { ReadinessService } from "../observability/readiness.service.js";

const ENVELOPE_KEYS = ["schema", "key_id", "tuple", "signature"] as const;
const TUPLE_KEYS = [
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
const SEMANTIC_FIELDS = [
  "protocol_id",
  "height",
  "block_hash",
  "event_root",
  "object_state_root",
  "chained_root",
  "founding_created",
  "all_objects",
  "active_objects",
] as const satisfies readonly (keyof AgreementTuple)[];
const MAX_AGREEMENT_RESPONSE_BYTES = 65_536;

export class AgreementVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgreementVerificationError";
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgreementVerificationError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new AgreementVerificationError(`${label} has an invalid shape`);
  }
  return record;
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new AgreementVerificationError(`${key} must be a string`);
  }
  return value;
}

async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) throw new AgreementVerificationError("pipeline B response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AGREEMENT_RESPONSE_BYTES) {
        throw new AgreementVerificationError("pipeline B response is too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export function parseAgreementEnvelope(value: unknown): SignedAgreementEnvelope {
  const envelope = exactRecord(value, ENVELOPE_KEYS, "agreement envelope");
  const tupleRecord = exactRecord(envelope.tuple, TUPLE_KEYS, "agreement tuple");
  const tuple = Object.fromEntries(
    TUPLE_KEYS.map((key) => [key, textField(tupleRecord, key)]),
  ) as unknown as AgreementTuple;
  try {
    assertAgreementTuple(tuple);
  } catch (error) {
    throw new AgreementVerificationError(
      error instanceof Error ? error.message : "agreement tuple is invalid",
    );
  }
  return {
    schema: textField(envelope, "schema") as SignedAgreementEnvelope["schema"],
    key_id: textField(envelope, "key_id"),
    tuple,
    signature: textField(envelope, "signature"),
  };
}

export interface VerifiedPipelineIdentity {
  keyId: string;
  signature: string;
  release: ReleaseIdentity;
}

export interface VerificationMetadata {
  status: "verified";
  height: number;
  blockHash: string;
  chainedRoot: string;
  pipelineA: VerifiedPipelineIdentity;
  pipelineB: VerifiedPipelineIdentity;
}

export interface VerifiedResponse<T> {
  verification: VerificationMetadata;
  data: T;
}

function releaseIdentity(tuple: AgreementTuple): ReleaseIdentity {
  return {
    parserCommit: tuple.parser_commit,
    indexerCommit: tuple.indexer_commit,
    parserBinarySha256: tuple.parser_binary_sha256,
    indexerBinarySha256: tuple.indexer_binary_sha256,
  };
}

function verifyTrustedEnvelope(
  value: unknown,
  trustedKeys: Readonly<Record<string, string>>,
  pipeline: string,
): SignedAgreementEnvelope {
  const envelope = parseAgreementEnvelope(value);
  if (envelope.schema !== "urn:tandem:agreement-envelope:v1") {
    throw new AgreementVerificationError(`${pipeline} envelope schema is not supported`);
  }
  if (!Object.hasOwn(trustedKeys, envelope.key_id)) {
    throw new AgreementVerificationError(`${pipeline} key is not trusted`);
  }
  const publicKey = trustedKeys[envelope.key_id];
  if (!publicKey) throw new AgreementVerificationError(`${pipeline} key is not trusted`);
  if (!verifyAgreementEnvelope(envelope, publicKey)) {
    throw new AgreementVerificationError(`${pipeline} signature is invalid`);
  }
  return envelope;
}

export function establishVerifiedAgreement(input: {
  pipelineA: unknown;
  pipelineB: unknown;
  pipelineATrustedKeys: Readonly<Record<string, string>>;
  pipelineBTrustedKeys: Readonly<Record<string, string>>;
}): VerificationMetadata {
  const pipelineA = verifyTrustedEnvelope(
    input.pipelineA,
    input.pipelineATrustedKeys,
    "pipeline A",
  );
  const pipelineB = verifyTrustedEnvelope(
    input.pipelineB,
    input.pipelineBTrustedKeys,
    "pipeline B",
  );
  for (const field of SEMANTIC_FIELDS) {
    if (pipelineA.tuple[field] !== pipelineB.tuple[field]) {
      throw new AgreementVerificationError(`agreement mismatch at ${field}`);
    }
  }
  return {
    status: "verified",
    height: Number(pipelineA.tuple.height),
    blockHash: pipelineA.tuple.block_hash,
    chainedRoot: pipelineA.tuple.chained_root,
    pipelineA: {
      keyId: pipelineA.key_id,
      signature: pipelineA.signature,
      release: releaseIdentity(pipelineA.tuple),
    },
    pipelineB: {
      keyId: pipelineB.key_id,
      signature: pipelineB.signature,
      release: releaseIdentity(pipelineB.tuple),
    },
  };
}

@Injectable()
export class VerifiedGatewayService {
  private readonly logger = new Logger(VerifiedGatewayService.name);

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<AppConfiguration, true>,
    @Inject(ReadinessService)
    private readonly readiness: ReadinessService,
    @Inject(AgreementQueryService)
    private readonly agreements: AgreementQueryService,
  ) {}

  async execute<T>(query: () => Promise<T>): Promise<VerifiedResponse<T>> {
    let before: VerificationMetadata;
    try {
      before = await this.resolve();
    } catch (error) {
      await query();
      this.verificationUnavailable(error);
    }
    const data = await query();
    let after: VerificationMetadata;
    try {
      after = await this.resolve();
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new AgreementVerificationError("verified agreement changed during data read");
      }
    } catch (error) {
      this.verificationUnavailable(error);
    }
    return { verification: after, data };
  }

  private verificationUnavailable(error: unknown): never {
    this.logger.warn(
      `verified response withheld: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    throw new ServiceUnavailableException({
      status: "verification_unavailable",
      error: "verification_unavailable",
    });
  }

  private async resolve(): Promise<VerificationMetadata> {
    const snapshot = await this.readiness.probe();
    if (!snapshot.ready || snapshot.canonicalHeight === null) {
      throw new AgreementVerificationError("pipeline A is not ready at a canonical height");
    }
    const deployment = this.config.get("deployment", { infer: true });
    const verification = this.config.get("verification", { infer: true });
    if (deployment.network === "mainnet" && !verification.mainnetEnabled) {
      throw new AgreementVerificationError("verified mainnet responses are disabled");
    }
    if (!verification.pipelineBBaseUrl) {
      throw new AgreementVerificationError("pipeline B endpoint is not configured");
    }
    const height = snapshot.canonicalHeight;
    const [pipelineA, pipelineB] = await Promise.all([
      this.agreements.signedAt(height),
      this.fetchPipelineB(verification.pipelineBBaseUrl, height, verification.requestTimeoutMs),
    ]);
    const metadata = establishVerifiedAgreement({
      pipelineA,
      pipelineB,
      pipelineATrustedKeys: verification.pipelineATrustedKeys,
      pipelineBTrustedKeys: verification.pipelineBTrustedKeys,
    });
    if (metadata.height !== height || pipelineA.tuple.protocol_id !== deployment.protocolId) {
      throw new AgreementVerificationError("agreement is not for the requested deployment height");
    }
    return metadata;
  }

  private async fetchPipelineB(
    baseUrl: string,
    height: number,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/v1/agreement/${height}`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AgreementVerificationError(`pipeline B returned HTTP ${response.status}`);
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_AGREEMENT_RESPONSE_BYTES) {
        throw new AgreementVerificationError("pipeline B response is too large");
      }
      const body = await readLimitedBody(response);
      return JSON.parse(body) as unknown;
    } catch (error) {
      if (error instanceof AgreementVerificationError) throw error;
      throw new AgreementVerificationError(
        `pipeline B agreement is unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
