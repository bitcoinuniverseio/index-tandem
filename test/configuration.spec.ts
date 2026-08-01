import { describe, expect, it } from "vitest";
import { ConfigurationError, loadConfiguration } from "../src/config/configuration.js";
import { validEnvironment } from "./fixtures.js";

describe("loadConfiguration", () => {
  it("binds the protocol ID to the configured network and INIT", () => {
    const configuration = loadConfiguration(validEnvironment());
    expect(configuration.deployment.protocolId).toBe("tndm:v1:regtest:" + "11".repeat(32));
    expect(configuration.bitcoin.expectedChain).toBe("regtest");
    expect(configuration.agreement.privateKeyHex).toBeUndefined();
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
});
