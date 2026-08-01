import { describe, expect, it } from "vitest";
import { ConfigurationError, loadConfiguration } from "../src/config/configuration.js";
import { validEnvironment } from "./fixtures.js";

describe("loadConfiguration", () => {
  it("binds the protocol ID to the configured network and INIT", () => {
    const configuration = loadConfiguration(validEnvironment());
    expect(configuration.deployment.protocolId).toBe("tndm:v1:regtest:" + "11".repeat(32));
    expect(configuration.service.host).toBe("127.0.0.1");
    expect(configuration.bitcoin.expectedChain).toBe("regtest");
    expect(configuration.agreement.privateKeyHex).toBeUndefined();
    expect(configuration.verification.mainnetEnabled).toBe(false);
    expect(configuration.verification.pipelineATrustedKeys).toEqual({});
  });

  it("rejects a namespace that is not derived from the INIT tuple", () => {
    expect(() =>
      loadConfiguration(validEnvironment({ TANDEM_NAMESPACE: "ff".repeat(32) })),
    ).toThrow(ConfigurationError);
  });

  it("rejects a founding window with the wrong width", () => {
    expect(() => loadConfiguration(validEnvironment({ TANDEM_CLOSE_HEIGHT: "6335" }))).toThrow(
      "TANDEM_CLOSE_HEIGHT",
    );
  });

  it("parses trusted Ed25519 registries and the explicit mainnet gate", () => {
    const configuration = loadConfiguration(
      validEnvironment({
        PIPELINE_B_BASE_URL: "https://verifier.example.test/",
        PIPELINE_A_TRUSTED_KEYS_JSON: JSON.stringify({ "pipeline-a": "aa".repeat(32) }),
        PIPELINE_B_TRUSTED_KEYS_JSON: JSON.stringify({ "pipeline-b": "bb".repeat(32) }),
        TANDEM_VERIFIED_MAINNET_ENABLED: "true",
      }),
    );
    expect(configuration.verification.pipelineBBaseUrl).toBe("https://verifier.example.test");
    expect(configuration.verification.mainnetEnabled).toBe(true);
    expect(configuration.verification.pipelineATrustedKeys["pipeline-a"]).toBe("aa".repeat(32));
  });

  it("rejects malformed trusted key registries", () => {
    expect(() =>
      loadConfiguration(validEnvironment({ PIPELINE_A_TRUSTED_KEYS_JSON: "[]" })),
    ).toThrow("JSON object");
    expect(() =>
      loadConfiguration(
        validEnvironment({ PIPELINE_B_TRUSTED_KEYS_JSON: JSON.stringify({ key: "not-hex" }) }),
      ),
    ).toThrow("Ed25519 public key");
  });
});
