import { describe, expect, it, vi } from "vitest";
import { TandemCatalogService } from "../src/api/tandem-catalog.service.js";
import type { VerificationMetadata } from "../src/verification/verified-gateway.service.js";

const hex = (v: string) => v.repeat(64);
function fixture() {
  const verification = {
    status: "verified",
    protocolId: `tndm:signet:${hex("a")}`,
    network: "signet",
    specHash: hex("b"),
    height: 1200,
    blockHash: hex("c"),
    chainedRoot: hex("d"),
    eventRoot: hex("e"),
    objectStateRoot: hex("f"),
    foundingCreated: "1",
    allObjects: "3",
    activeObjects: "1",
    pipelineA: { keyId: "a", signature: "real-fixture-a", release: {} },
    pipelineB: { keyId: "b", signature: "real-fixture-b", release: {} },
  } as VerificationMetadata;
  const rows = [3, 2, 1].map((n) => ({
    objectKey: hex(String(n)),
    createTxid: hex(String(n + 3)),
    createHeight: 100 + n,
    founding: n === 3 ? 1 : 0,
    status: n === 1 ? "active" : "closed",
  }));
  let epoch = "0",
    total = "3";
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes("FROM tandem_blocks"))
      return [
        {
          height: verification.height,
          hash: verification.blockHash,
          eventRoot: verification.eventRoot,
          objectStateRoot: verification.objectStateRoot,
          chainedRoot: verification.chainedRoot,
        },
      ];
    if (sql.includes("MAX(id)")) return [{ epoch }];
    if (sql.includes("COUNT(*)")) return [{ total, founding: "1", active: "1" }];
    const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1]);
    return rows
      .filter(
        (row) =>
          !params.length ||
          row.createHeight < Number(params[0]) ||
          (row.createHeight === Number(params[1]) && row.objectKey > String(params[2])),
      )
      .slice(0, limit);
  });
  const runner = {
    query,
    connect: vi.fn(async () => undefined),
    startTransaction: vi.fn(async () => undefined),
    commitTransaction: vi.fn(async () => undefined),
    rollbackTransaction: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    isTransactionActive: true,
  };
  const gateway = {
    executeBound: vi.fn(async (cb: (v: VerificationMetadata) => Promise<unknown>) => ({
      verification,
      data: await cb(verification),
    })),
  };
  const rpc = { getBlockHash: vi.fn(async () => verification.blockHash) };
  const config = { get: vi.fn(() => ({ token: "t".repeat(32), cursorSecret: "s".repeat(32) })) };
  const service = new TandemCatalogService(
    { createQueryRunner: () => runner } as never,
    config as never,
    gateway as never,
    rpc as never,
  );
  return {
    service,
    gateway,
    runner,
    query,
    rpc,
    verification,
    changeEpoch: () => {
      epoch = "1";
    },
    changeCount: () => {
      total = "4";
    },
  };
}
const auth = `Bearer ${"t".repeat(32)}`;

describe("authenticated complete Tandem catalog", () => {
  it("retains both admission slots after deadline and starts no SQL after late initial verification", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      const f = fixture();
      let resume: () => void = () => undefined;
      const wait = new Promise<void>((resolve) => {
        resume = resolve;
      });
      f.gateway.executeBound.mockImplementation(async (cb) => {
        await wait;
        return { verification: f.verification, data: await cb(f.verification) };
      });
      const first = f.service.page(auth, "2", undefined).catch((error) => error);
      const second = f.service.page(auth, "2", undefined).catch((error) => error);
      await expect(f.service.page(auth, "2", undefined)).rejects.toThrow("busy");
      await vi.advanceTimersByTimeAsync(15_001);
      expect((await first).message).toContain("deadline");
      expect((await second).message).toContain("deadline");
      await expect(f.service.page(auth, "2", undefined)).rejects.toThrow("busy");
      resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.query).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("returns all three actual fixture rows in fenced keyset pages with exact terminal continuation", async () => {
    const f = fixture();
    const first = (await f.service.page(auth, "2", undefined)) as {
      data: { items: unknown[]; nextCursor: string; hasMore: boolean; totalAtomic: string };
    };
    expect(first.data.items).toHaveLength(2);
    expect(first.data.totalAtomic).toBe("3");
    expect(first.data.hasMore).toBe(true);
    const last = (await f.service.page(auth, "2", first.data.nextCursor)) as {
      data: { items: unknown[]; nextCursor: unknown; hasMore: boolean };
    };
    expect(last.data.items).toHaveLength(1);
    expect(last.data.hasMore).toBe(false);
    expect(last.data.nextCursor).toBeNull();
    expect(f.runner.startTransaction).toHaveBeenCalledWith("REPEATABLE READ");
    expect(f.runner.commitTransaction).toHaveBeenCalledTimes(2);
    expect(f.runner.release).toHaveBeenCalledTimes(2);
  });
  it("rejects unauthenticated, malformed bounds and forged cursors before authority or SQL I/O", async () => {
    const f = fixture();
    for (const args of [
      ["wrong", "1", undefined],
      [auth, "201", undefined],
      [auth, ["1"], undefined],
      [auth, "2", "forged.cursor"],
    ]) {
      await expect(f.service.page(...(args as [unknown, unknown, unknown]))).rejects.toThrow();
    }
    expect(f.gateway.executeBound).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
  });
  it("refuses a changed page size and a durable reorg epoch even when height/hash return to the same values", async () => {
    const f = fixture();
    const first = (await f.service.page(auth, "2", undefined)) as { data: { nextCursor: string } };
    await expect(f.service.page(auth, "1", first.data.nextCursor)).rejects.toThrow(
      "invalid catalog cursor",
    );
    f.changeEpoch();
    await expect(f.service.page(auth, "2", first.data.nextCursor)).rejects.toThrow(
      "snapshot changed",
    );
    expect(f.runner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });
  it("withholds SQL membership/count mismatch and rolls back, releases once", async () => {
    const f = fixture();
    f.changeCount();
    await expect(f.service.page(auth, "2", undefined)).rejects.toThrow(
      "differs from signed agreement",
    );
    expect(f.runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(f.runner.release).toHaveBeenCalledTimes(1);
    expect(f.rpc.getBlockHash).not.toHaveBeenCalled();
  });
  it("withholds a checkpoint displaced on independently queried Core", async () => {
    const f = fixture();
    f.rpc.getBlockHash.mockResolvedValue(hex("0"));
    await expect(f.service.page(auth, "2", undefined)).rejects.toThrow("not canonical");
  });
  it("does no data read if initial verification fails", async () => {
    const f = fixture();
    f.gateway.executeBound.mockRejectedValue(new Error("signature mismatch"));
    await expect(f.service.page(auth, "2", undefined)).rejects.toThrow("signature mismatch");
    expect(f.query).not.toHaveBeenCalled();
  });
});
