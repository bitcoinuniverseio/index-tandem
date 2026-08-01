import { carrierScriptPubKey, sortAndValidateKeys } from "@bitcoinuniverse/tandem";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { describe, expect, it } from "vitest";
import { decodeCarrierAddress, encodeCarrierAddress } from "../src/api/carrier-address.js";

function carrierProgram(): string {
  const first = secp256k1.getPublicKey(
    Uint8Array.from({ length: 32 }, () => 1),
    true,
  );
  const second = secp256k1.getPublicKey(
    Uint8Array.from({ length: 32 }, () => 2),
    true,
  );
  const [key0, key1] = sortAndValidateKeys(first, second);
  return Buffer.from(carrierScriptPubKey(key0, key1).slice(2)).toString("hex");
}

describe("carrier P2WSH address", () => {
  it("round-trips the protocol carrier program on every deployment HRP", () => {
    const program = carrierProgram();
    for (const [network, prefix] of [
      ["mainnet", "bc1q"],
      ["signet", "tb1q"],
      ["testnet4", "tb1q"],
      ["regtest", "bcrt1q"],
    ] as const) {
      const address = encodeCarrierAddress(program, network);
      expect(address.startsWith(prefix)).toBe(true);
      expect(decodeCarrierAddress(address, network)).toEqual({
        address,
        witnessProgramHex: program,
      });
      expect(decodeCarrierAddress(address.toUpperCase(), network)?.address).toBe(address);
    }
  });

  it("rejects the wrong network, mixed case, and checksum corruption", () => {
    const address = encodeCarrierAddress(carrierProgram(), "regtest");
    expect(decodeCarrierAddress(address, "mainnet")).toBeNull();
    expect(
      decodeCarrierAddress(`${address.slice(0, 3).toUpperCase()}${address.slice(3)}`, "regtest"),
    ).toBeNull();
    const replacement = address.endsWith("q") ? "p" : "q";
    expect(decodeCarrierAddress(`${address.slice(0, -1)}${replacement}`, "regtest")).toBeNull();
  });
});
