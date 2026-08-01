import { describe, expect, it } from "vitest";
import { evaluateReadiness, type ReadinessInput } from "../src/observability/readiness.service.js";

const readyInput: ReadinessInput = {
  configurationValid: true,
  databaseAvailable: true,
  coreAvailable: true,
  coreNetworkMatches: true,
  coreInitialBlockDownload: false,
  nodeHeight: 1200,
  canonicalHeight: 1199,
  checkpointHeight: 1199,
  maxBlockLag: 2,
  signerConfigured: true,
};

describe("evaluateReadiness", () => {
  it("is ready only when every gate passes", () => {
    expect(evaluateReadiness(readyInput)).toMatchObject({ ready: true, reasons: [] });
  });

  it("fails closed for a wrong network, stale tip, incomplete checkpoint, and missing signer", () => {
    const result = evaluateReadiness({
      ...readyInput,
      coreNetworkMatches: false,
      canonicalHeight: 1190,
      checkpointHeight: 1189,
      signerConfigured: false,
    });
    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual([
      "bitcoin_network_mismatch",
      "canonical_tip_stale",
      "checkpoint_incomplete",
      "agreement_signer_unavailable",
    ]);
  });
});
