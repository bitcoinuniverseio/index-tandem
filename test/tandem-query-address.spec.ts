import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { encodeCarrierAddress } from "../src/api/carrier-address.js";
import { TandemQueryService } from "../src/api/tandem-query.service.js";

describe("carrier address query", () => {
  it("matches the decoded witness program against persisted state keys", async () => {
    const dataSource = { query: vi.fn(async () => []) };
    const config = { get: () => ({ network: "regtest" }) };
    const service = new TandemQueryService(dataSource as never, config as never);
    const program = "ab".repeat(32);
    const address = encodeCarrierAddress(program, "regtest");
    await expect(service.address(address, 25)).resolves.toEqual({ address, items: [] });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE s.carrier_program = ?"),
      [address, program, 25],
    );
  });

  it("rejects invalid or wrong-network addresses before querying", async () => {
    const dataSource = { query: vi.fn() };
    const config = { get: () => ({ network: "regtest" }) };
    const service = new TandemQueryService(dataSource as never, config as never);
    const mainnet = encodeCarrierAddress("cd".repeat(32), "mainnet");
    await expect(service.address(mainnet, 25)).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
