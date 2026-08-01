import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import {
  type AgreementTuple,
  canonicalAgreementBytes,
  signAgreementTuple,
  signingBoundaryConfigured,
  verifyAgreementEnvelope,
} from "../src/agreement/agreement.service.js";

const tuple: AgreementTuple = {
  schema: "urn:tandem:agreement-tuple:v1",
  protocol_id: "tndm:v1:regtest:" + "11".repeat(32),
  height: "1200",
  block_hash: "22".repeat(32),
  event_root: "33".repeat(32),
  object_state_root: "44".repeat(32),
  chained_root: "55".repeat(32),
  founding_created: "10",
  all_objects: "12",
  active_objects: "11",
  parser_commit: "66".repeat(20),
  indexer_commit: "77".repeat(20),
  parser_binary_sha256: "88".repeat(32),
  indexer_binary_sha256: "99".repeat(32),
};

describe("agreement boundary", () => {
  it("canonicalizes the canonical snake_case tuple and verifies Ed25519", () => {
    const privateKey = "01".repeat(32);
    const publicKey = Buffer.from(
      ed25519.getPublicKey(Uint8Array.from(Buffer.from(privateKey, "hex"))),
    ).toString("hex");
    const envelope = signAgreementTuple(tuple, "test-key", privateKey);
    expect(envelope.schema).toBe("urn:tandem:agreement-envelope:v1");
    expect(Object.keys(envelope).sort()).toEqual(["key_id", "schema", "signature", "tuple"]);
    expect(Object.keys(envelope.tuple).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(new TextDecoder().decode(canonicalAgreementBytes(tuple))).toContain(
      '"active_objects":"11"',
    );
    expect(verifyAgreementEnvelope(envelope, publicKey)).toBe(true);
    expect(
      verifyAgreementEnvelope(
        { ...envelope, tuple: { ...tuple, height: String(Number(tuple.height) + 1) } },
        publicKey,
      ),
    ).toBe(false);
  });

  it("fails readiness for missing release identity or mismatching public key", () => {
    const privateKey = "01".repeat(32);
    const publicKey = Buffer.from(
      ed25519.getPublicKey(Uint8Array.from(Buffer.from(privateKey, "hex"))),
    ).toString("hex");
    const release = {
      parserCommit: tuple.parser_commit,
      indexerCommit: tuple.indexer_commit,
      parserBinarySha256: tuple.parser_binary_sha256,
      indexerBinarySha256: tuple.indexer_binary_sha256,
    };
    expect(
      signingBoundaryConfigured({
        keyId: "test-key",
        privateKeyHex: privateKey,
        publicKeyHex: publicKey,
        ...release,
      }),
    ).toBe(true);
    expect(
      signingBoundaryConfigured({
        keyId: "test-key",
        privateKeyHex: privateKey,
        publicKeyHex: "ff".repeat(32),
        ...release,
      }),
    ).toBe(false);
    expect(
      signingBoundaryConfigured({
        keyId: "test-key",
        privateKeyHex: privateKey,
      }),
    ).toBe(false);
  });
});
