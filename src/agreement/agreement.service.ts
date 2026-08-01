import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ed25519 } from "@noble/curves/ed25519.js";
import { canonicalize } from "json-canonicalize";
import type { AppConfiguration } from "../config/configuration.js";

const HASH_HEX = /^[0-9a-f]{64}$/;

export interface AgreementTuple {
  schema: "tandem-agreement-tuple/v1";
  protocolId: string;
  network: string;
  height: number;
  blockHash: string;
  eventRoot: string;
  objectStateRoot: string;
  chainedRoot: string;
  foundingCreated: string;
  allObjects: string;
  activeObjects: string;
}

export interface SignedAgreementEnvelope {
  schema: "tandem-agreement-envelope/v1";
  algorithm: "Ed25519";
  canonicalization: "RFC8785";
  keyId: string;
  publicKeyHex: string;
  tuple: AgreementTuple;
  signatureHex: string;
}

function assertTuple(tuple: AgreementTuple): void {
  if (!Number.isSafeInteger(tuple.height) || tuple.height < 0)
    throw new Error("invalid tuple height");
  for (const [name, value] of Object.entries({
    blockHash: tuple.blockHash,
    eventRoot: tuple.eventRoot,
    objectStateRoot: tuple.objectStateRoot,
    chainedRoot: tuple.chainedRoot,
  })) {
    if (!HASH_HEX.test(value)) throw new Error(`invalid tuple ${name}`);
  }
  for (const value of [tuple.foundingCreated, tuple.allObjects, tuple.activeObjects]) {
    if (!/^\d+$/.test(value)) throw new Error("agreement counts must be decimal strings");
  }
}

export function canonicalAgreementBytes(tuple: AgreementTuple): Uint8Array {
  assertTuple(tuple);
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
  if (privateKey.length !== 32 || !keyId) throw new Error("invalid agreement signing boundary");
  const publicKey = ed25519.getPublicKey(privateKey);
  const signature = ed25519.sign(canonicalAgreementBytes(tuple), privateKey);
  return {
    schema: "tandem-agreement-envelope/v1",
    algorithm: "Ed25519",
    canonicalization: "RFC8785",
    keyId,
    publicKeyHex: Buffer.from(publicKey).toString("hex"),
    tuple,
    signatureHex: Buffer.from(signature).toString("hex"),
  };
}

export function verifyAgreementEnvelope(envelope: SignedAgreementEnvelope): boolean {
  try {
    return ed25519.verify(
      Uint8Array.from(Buffer.from(envelope.signatureHex, "hex")),
      canonicalAgreementBytes(envelope.tuple),
      Uint8Array.from(Buffer.from(envelope.publicKeyHex, "hex")),
    );
  } catch {
    return false;
  }
}

export function signingBoundaryConfigured(agreement: {
  keyId?: string;
  privateKeyHex?: string;
  publicKeyHex?: string;
}): boolean {
  if (!agreement.keyId || !agreement.privateKeyHex) return false;
  try {
    const privateKey = Uint8Array.from(Buffer.from(agreement.privateKeyHex, "hex"));
    if (privateKey.length !== 32) return false;
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
    const agreement = this.config.get("agreement", { infer: true });
    return signingBoundaryConfigured(agreement);
  }

  sign(tuple: AgreementTuple): SignedAgreementEnvelope {
    const agreement = this.config.get("agreement", { infer: true });
    if (!agreement.keyId || !agreement.privateKeyHex) {
      throw new Error("agreement signing key is not configured");
    }
    const envelope = signAgreementTuple(tuple, agreement.keyId, agreement.privateKeyHex);
    if (agreement.publicKeyHex && envelope.publicKeyHex !== agreement.publicKeyHex) {
      throw new Error("agreement public key does not match the configured private key");
    }
    return envelope;
  }
}
