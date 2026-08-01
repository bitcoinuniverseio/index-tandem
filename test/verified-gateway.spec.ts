import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it, vi } from "vitest";
import { type AgreementTuple, signAgreementTuple } from "../src/agreement/agreement.service.js";
import {
  establishVerifiedAgreement,
  parseAgreementEnvelope,
  VerifiedGatewayService,
} from "../src/verification/verified-gateway.service.js";

const baseTuple: AgreementTuple = {
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

function publicKey(privateKey: string): string {
  return Buffer.from(
    ed25519.getPublicKey(Uint8Array.from(Buffer.from(privateKey, "hex"))),
  ).toString("hex");
}

function fixture() {
  const keyA = "01".repeat(32);
  const keyB = "02".repeat(32);
  const pipelineA = signAgreementTuple(baseTuple, "pipeline-a", keyA);
  const pipelineB = signAgreementTuple(
    {
      ...baseTuple,
      parser_commit: "aa".repeat(20),
      indexer_commit: "bb".repeat(20),
      parser_binary_sha256: "cc".repeat(32),
      indexer_binary_sha256: "dd".repeat(32),
    },
    "pipeline-b",
    keyB,
  );
  return {
    pipelineA,
    pipelineB,
    pipelineATrustedKeys: { "pipeline-a": publicKey(keyA) },
    pipelineBTrustedKeys: { "pipeline-b": publicKey(keyB) },
  };
}

describe("verified agreement gateway", () => {
  it("accepts a semantic match while preserving each signed release identity", () => {
    const metadata = establishVerifiedAgreement(fixture());
    expect(metadata).toMatchObject({
      status: "verified",
      height: 1200,
      blockHash: "22".repeat(32),
      chainedRoot: "55".repeat(32),
      pipelineA: { keyId: "pipeline-a", release: { parserCommit: "66".repeat(20) } },
      pipelineB: { keyId: "pipeline-b", release: { parserCommit: "aa".repeat(20) } },
    });
    expect(metadata.pipelineA.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(metadata.pipelineB.signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it("rejects mismatching roots, untrusted keys, and tampered signatures", () => {
    const rootMismatch = fixture();
    rootMismatch.pipelineB = signAgreementTuple(
      { ...rootMismatch.pipelineB.tuple, chained_root: "ee".repeat(32) },
      "pipeline-b",
      "02".repeat(32),
    );
    expect(() => establishVerifiedAgreement(rootMismatch)).toThrow("chained_root");

    const untrusted = fixture();
    expect(() => establishVerifiedAgreement({ ...untrusted, pipelineBTrustedKeys: {} })).toThrow(
      "not trusted",
    );

    const tampered = fixture();
    tampered.pipelineB.signature = `${tampered.pipelineB.signature[0] === "0" ? "1" : "0"}${tampered.pipelineB.signature.slice(1)}`;
    expect(() => establishVerifiedAgreement(tampered)).toThrow("signature is invalid");
  });

  it("rejects non-canonical envelope shapes before verification", () => {
    const { pipelineA } = fixture();
    expect(() => parseAgreementEnvelope({ ...pipelineA, public_key: "ff".repeat(32) })).toThrow(
      "invalid shape",
    );
    expect(() =>
      parseAgreementEnvelope({ ...pipelineA, tuple: { ...pipelineA.tuple, height: 1 } }),
    ).toThrow("must be a string");
  });

  it("returns only verification_unavailable when readiness cannot establish freshness", async () => {
    const config = { get: () => ({}) };
    const readiness = {
      probe: async () => ({ ready: false, canonicalHeight: null }),
    };
    const agreements = { signedAt: async () => fixture().pipelineA };
    const service = new VerifiedGatewayService(
      config as never,
      readiness as never,
      agreements as never,
    );
    await expect(service.execute(async () => ({ value: 1 }))).rejects.toSatisfy(
      (error: unknown) => {
        if (!(error instanceof ServiceUnavailableException)) return false;
        return (
          error.getResponse() instanceof Object &&
          (error.getResponse() as { status?: string }).status === "verification_unavailable"
        );
      },
    );
    await expect(
      service.execute(async () => {
        throw new NotFoundException("object not found");
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("keeps verified mainnet responses disabled unless explicitly enabled", async () => {
    const config = {
      get: (key: string) =>
        key === "deployment"
          ? { network: "mainnet", protocolId: "tndm:v1:mainnet:" + "11".repeat(32) }
          : {
              pipelineBBaseUrl: "https://pipeline-b.example.test",
              requestTimeoutMs: 1000,
              mainnetEnabled: false,
              pipelineATrustedKeys: {},
              pipelineBTrustedKeys: {},
            },
    };
    const readiness = { probe: async () => ({ ready: true, canonicalHeight: 1200 }) };
    const agreements = { signedAt: vi.fn() };
    const service = new VerifiedGatewayService(
      config as never,
      readiness as never,
      agreements as never,
    );
    await expect(service.execute(async () => ({ value: 1 }))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(agreements.signedAt).not.toHaveBeenCalled();
  });

  it("requests pipeline B at the canonical height and wraps data on verified agreement", async () => {
    const agreements = fixture();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(agreements.pipelineB), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const config = {
        get: (key: string) => {
          if (key === "deployment") {
            return { network: "regtest", protocolId: baseTuple.protocol_id };
          }
          if (key === "verification") {
            return {
              pipelineBBaseUrl: "https://pipeline-b.example.test",
              requestTimeoutMs: 1000,
              mainnetEnabled: false,
              pipelineATrustedKeys: agreements.pipelineATrustedKeys,
              pipelineBTrustedKeys: agreements.pipelineBTrustedKeys,
            };
          }
          throw new Error(`unexpected config key ${key}`);
        },
      };
      const readiness = { probe: async () => ({ ready: true, canonicalHeight: 1200 }) };
      const query = { signedAt: vi.fn(async () => agreements.pipelineA) };
      const service = new VerifiedGatewayService(
        config as never,
        readiness as never,
        query as never,
      );
      const response = await service.execute(async () => ({ value: 1 }));
      expect(response.verification.status).toBe("verified");
      expect(response.data).toEqual({ value: 1 });
      expect(query.signedAt).toHaveBeenCalledWith(1200);
      expect(query.signedAt).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://pipeline-b.example.test/v1/agreement/1200",
        expect.objectContaining({ headers: { accept: "application/json" } }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("withholds data when the canonical height changes during the query", async () => {
    const agreements = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(agreements.pipelineB), {
            status: 200,
          }),
      ),
    );
    try {
      const config = {
        get: (key: string) =>
          key === "deployment"
            ? { network: "regtest", protocolId: baseTuple.protocol_id }
            : {
                pipelineBBaseUrl: "https://pipeline-b.example.test",
                requestTimeoutMs: 1000,
                mainnetEnabled: false,
                pipelineATrustedKeys: agreements.pipelineATrustedKeys,
                pipelineBTrustedKeys: agreements.pipelineBTrustedKeys,
              },
      };
      const readiness = {
        probe: vi
          .fn()
          .mockResolvedValueOnce({ ready: true, canonicalHeight: 1200 })
          .mockResolvedValueOnce({ ready: true, canonicalHeight: 1201 }),
      };
      const agreementQuery = { signedAt: vi.fn(async () => agreements.pipelineA) };
      const dataQuery = vi.fn(async () => ({ value: 1 }));
      const service = new VerifiedGatewayService(
        config as never,
        readiness as never,
        agreementQuery as never,
      );
      await expect(service.execute(dataQuery)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(dataQuery).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
