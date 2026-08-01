import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { TandemController } from "../src/api/tandem.controller.js";
import { VerifiedTandemController } from "../src/api/verified-tandem.controller.js";

const PATH_METADATA = "path";

describe("verified explorer controller", () => {
  it("publishes the complete explorer route surface", () => {
    expect(Reflect.getMetadata(PATH_METADATA, TandemController)).toBe("tandem");
    expect(Reflect.getMetadata(PATH_METADATA, VerifiedTandemController)).toBe("tandem/verified");
    const prototype = VerifiedTandemController.prototype;
    expect(
      Object.fromEntries(
        [
          "status",
          "objects",
          "object",
          "events",
          "transaction",
          "address",
          "invalidEvents",
          "mempool",
          "conflicts",
          "reorgs",
          "stats",
          "search",
        ].map((method) => [method, Reflect.getMetadata(PATH_METADATA, prototype[method as never])]),
      ),
    ).toEqual({
      status: "status",
      objects: "objects",
      object: "objects/:key",
      events: "events/:txid",
      transaction: "transactions/:txid",
      address: "addresses/:address",
      invalidEvents: "invalid-events",
      mempool: "mempool",
      conflicts: "conflicts",
      reorgs: "reorgs",
      stats: "stats",
      search: "search",
    });
  });

  it("wraps successful query data and preserves upstream 404 errors", async () => {
    const queries = {
      status: vi.fn(async () => ({ kind: "status" })),
      objects: vi.fn(async () => ({ kind: "objects" })),
      object: vi.fn(async () => ({ kind: "object" })),
      events: vi.fn(async () => ({ kind: "events" })),
      transaction: vi.fn(async () => ({ kind: "transaction" })),
      address: vi.fn(async () => ({ kind: "address" })),
      invalidEvents: vi.fn(async () => ({ kind: "invalidEvents" })),
      mempool: vi.fn(async () => ({ kind: "mempool" })),
      conflicts: vi.fn(async () => ({ kind: "conflicts" })),
      reorgs: vi.fn(async () => ({ kind: "reorgs" })),
      stats: vi.fn(async () => ({ kind: "stats" })),
      search: vi.fn(async () => ({ kind: "search" })),
    };
    const gateway = {
      execute: vi.fn(async (query: () => Promise<unknown>) => ({
        verification: { status: "verified" },
        data: await query(),
      })),
    };
    const controller = new VerifiedTandemController(queries as never, gateway as never);
    const responses = await Promise.all([
      controller.status(),
      controller.objects(10),
      controller.object("11".repeat(32)),
      controller.events("22".repeat(32)),
      controller.transaction("22".repeat(32)),
      controller.address("bcrt1qexampleaddress", 10),
      controller.invalidEvents(10),
      controller.mempool(10),
      controller.conflicts(10),
      controller.reorgs(10),
      controller.stats(),
      controller.search("query", 10),
    ]);
    expect(responses).toHaveLength(12);
    expect(gateway.execute).toHaveBeenCalledTimes(12);

    queries.object.mockRejectedValueOnce(new NotFoundException("object not found") as never);
    await expect(controller.object("33".repeat(32))).rejects.toBeInstanceOf(NotFoundException);
    expect(gateway.execute).toHaveBeenCalledTimes(13);
  });
});
