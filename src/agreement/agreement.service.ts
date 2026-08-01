import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ed25519 } from "@noble/curves/ed25519.js";
import { canonicalize } from "json-canonicalize";
import type { AppConfiguration } from "../config/configuration.js";

const HASH_HEX = /^[0-9a-f]{64}$/;
const COMMIT_HEX = /^[0-9a-f]{40}$/;
const COUNTER = /^(0|[1-9][0-9]*)$/;
const KEY_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const PROTOCOL_ID = /^tndm:v1:(mainnet|signet|testnet4|regtest):[0-9a-f]{64}$/;

export interface AgreementTuple {
  schema: "urn:tandem:agreement-tuple:v1";
  protocol_id: string;
  height: string;
  block_hash: string;
  event_root: string;
  object_state_root: string;
  chained_root: string;
  founding_created: string;
  all_objects: string;
  active_objects: string;
  parser_commit: string;
  indexer_commit: string;
  parser_binary_sha256: string;
  indexer_binary_sha256: string;
}

export interface SignedAgreementEnvelope {
  schema: "urn:tandem:agreement-envelope:v1";
  key_id: string;
  tuple: AgreementTuple;
  signature: string;
}

export interface ReleaseIdentity {
  parserCommit: string;
  indexerCommit: string;
  parserBinarySha256: string;
  indexerBinarySha256: string;
}

export function assertAgreementTuple(tuple: AgreementTuple): void {
  if (tuple.schema !== "urn:tandem:agreement-tuple:v1") {
    throw new Error("invalid agreement tuple schema");
  }
  if (!PROTOCOL_ID.test(tuple.protocol_id)) throw new Error("invalid agreement protocol id");
  for (const [name, value] of Object.entries({
    height: tuple.height,
    founding_created: tuple.founding_created,
    all_objects: tuple.all_objects,
    active_objects: tuple.active_objects,
  })) {
    if (!COUNTER.test(value)) throw new Error(`invalid agreement ${name}`);
  }
  const height = Number(tuple.height);
  if (!Number.isSafeInteger(height) || height < 0) throw new Error("agreement height is unsafe");
  for (const [name, value] of Object.entries({
    block_hash: tuple.block_hash,
    event_root: tuple.event_root,
    object_state_root: tuple.object_state_root,
    chained_root: tuple.chained_root,
    parser_binary_sha256: tuple.parser_binary_sha256,
    indexer_binary_sha256: tuple.indexer_binary_sha256,
  })) {
    if (!HASH_HEX.test(value)) throw new Error(`invalid agreement ${name}`);
  }
  if (!COMMIT_HEX.test(tuple.parser_commit) || !COMMIT_HEX.test(tuple.indexer_commit)) {
    throw new Error("invalid agreement release commit");
  }
}

export function canonicalAgreementBytes(tuple: AgreementTuple): Uint8Array {
  assertAgreementTuple(tuple);
  const canonical = canonicalize(tuple);
  if (typeof canonical !== "string") throw new Error("agreement tuple cannot be canonicalized");
  return new TextEncoder().encode(canonical);
}

export function signAgreementTuple(
  tuple: AgreementTuple,
  keyId: string,
  privateKeyHex: string,
): SignedAgreementEnvelope {
  const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, "hex"));
  if (privateKey.length !== 32 || !KEY_ID.test(keyId)) {
    throw new Error("invalid agreement signing boundary");
  }
  const signature = ed25519.sign(canonicalAgreementBytes(tuple), privateKey);
  return {
    schema: "urn:tandem:agreement-envelope:v1",
    key_id: keyId,
    tuple,
    signature: Buffer.from(signature).toString("hex"),
  };
}

export function verifyAgreementEnvelope(
  envelope: SignedAgreementEnvelope,
  publicKeyHex: string,
): boolean {
  try {
    if (
      envelope.schema !== "urn:tandem:agreement-envelope:v1" ||
      !KEY_ID.test(envelope.key_id) ||
      !/^[0-9a-f]{128}$/.test(envelope.signature) ||
      !HASH_HEX.test(publicKeyHex)
    ) {
      return false;
    }
    return ed25519.verify(
      Uint8Array.from(Buffer.from(envelope.signature, "hex")),
      canonicalAgreementBytes(envelope.tuple),
      Uint8Array.from(Buffer.from(publicKeyHex, "hex")),
      { zip215: false },
    );
  } catch {
    return false;
  }
}

export function signingBoundaryConfigured(agreement: {
  keyId?: string;
  privateKeyHex?: string;
  publicKeyHex?: string;
  parserCommit?: string;
  indexerCommit?: string;
  parserBinarySha256?: string;
  indexerBinarySha256?: string;
}): boolean {
  if (
    !agreement.keyId ||
    !agreement.privateKeyHex ||
    !agreement.parserCommit ||
    !agreement.indexerCommit ||
    !agreement.parserBinarySha256 ||
    !agreement.indexerBinarySha256
  ) {
    return false;
  }
  try {
    const privateKey = Uint8Array.from(Buffer.from(agreement.privateKeyHex, "hex"));
    if (privateKey.length !== 32 || !KEY_ID.test(agreement.keyId)) return false;
    const derivedPublicKey = Buffer.from(ed25519.getPublicKey(privateKey)).toString("hex");
    return !agreement.publicKeyHex || agreement.publicKeyHex === derivedPublicKey;
  } catch {
    return false;
  }
}

@Injectable()
export class AgreementSignerService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<AppConfiguration, true>,
  ) {}

  configured(): boolean {
    return signingBoundaryConfigured(this.config.get("agreement", { infer: true }));
  }

  releaseIdentity(): ReleaseIdentity {
    const agreement = this.config.get("agreement", { infer: true });
    if (
      !agreement.parserCommit ||
      !agreement.indexerCommit ||
      !agreement.parserBinarySha256 ||
      !agreement.indexerBinarySha256
    ) {
      throw new Error("agreement release identity is not configured");
    }
    return {
      parserCommit: agreement.parserCommit,
      indexerCommit: agreement.indexerCommit,
      parserBinarySha256: agreement.parserBinarySha256,
      indexerBinarySha256: agreement.indexerBinarySha256,
    };
  }

  sign(tuple: AgreementTuple): SignedAgreementEnvelope {
    const agreement = this.config.get("agreement", { infer: true });
    if (!this.configured() || !agreement.keyId || !agreement.privateKeyHex) {
      throw new Error("agreement signing boundary is not configured");
    }
    return signAgreementTuple(tuple, agreement.keyId, agreement.privateKeyHex);
  }
}
