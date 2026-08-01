import { describe, expect, it } from "vitest";
import {
  type AgreementTuple,
  canonicalAgreementBytes,
  signAgreementTuple,
  signingBoundaryConfigured,
  verifyAgreementEnvelope,
} from "../src/agreement/agreement.service.js";

const tuple: AgreementTuple = {
  schema: "tandem-agreement-tuple/v1",
  protocolId: "tndm:v1:regtest:" + "11".repeat(32),
  network: "regtest",
  height: 1200,
  blockHash: "22".repeat(32),
  eventRoot: "33".repeat(32),
  objectStateRoot: "44".repeat(32),
  chainedRoot: "55".repeat(32),
  foundingCreated: "10",
  allObjects: "12",
  activeObjects: "11",
};

describe("agreement boundary", () => {
  it("canonicalizes deterministically and verifies its Ed25519 signature", () => {
    const envelope = signAgreementTuple(tuple, "test-key", "01".repeat(32));
    expect(new TextDecoder().decode(canonicalAgreementBytes(tuple))).toContain(
      '"activeObjects":"11"',
    );
    expect(verifyAgreementEnvelope(envelope)).toBe(true);
    expect(
      verifyAgreementEnvelope({
        ...envelope,
        tuple: { ...tuple, height: tuple.height + 1 },
      }),
    ).toBe(false);
  });

  it("fails readiness when a configured public key does not match the private key", () => {
    const envelope = signAgreementTuple(tuple, "test-key", "01".repeat(32));
    expect(
      signingBoundaryConfigured({
        keyId: envelope.keyId,
        privateKeyHex: "01".repeat(32),
        publicKeyHex: envelope.publicKeyHex,
      }),
    ).toBe(true);
    expect(
      signingBoundaryConfigured({
        keyId: envelope.keyId,
        privateKeyHex: "01".repeat(32),
        publicKeyHex: "ff".repeat(32),
      }),
    ).toBe(false);
  });
});
