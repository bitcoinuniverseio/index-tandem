import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { afterEach, describe, expect, it } from "vitest";
import {
  BlockEventsService,
  decodeBlockEventsCursor,
  encodeBlockEventsCursor,
} from "../src/api/block-events.service.js";
import { ExplorerController } from "../src/api/explorer.controller.js";
import { ReadinessService } from "../src/observability/readiness.service.js";

const HASH_100 = "aa".repeat(32);
const HASH_101 = "bb".repeat(32);
const TIP_HASH = "cc".repeat(32);
const tx = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const OBJECT = "dd".repeat(32);

interface StoredEvent {
  blockHeight: number;
  txid: string;
  txIndex: number;
  eventIndex: number;
  subIndex: number;
  eventType: number;
  validityClass: number;
  objectKey: string | null;
  predecessorOutpoint: string | null;
  successorOutpoint: string | null;
}

function event(partial: Partial<StoredEvent> & Pick<StoredEvent, "txIndex">): StoredEvent {
  return {
    blockHeight: 100,
    txid: tx(partial.txIndex),
    eventIndex: 0,
    subIndex: 0,
    eventType: 2,
    validityClass: 1,
    objectKey: OBJECT,
    predecessorOutpoint: `${tx(1)}:1`,
    successorOutpoint: `${tx(partial.txIndex)}:1`,
    ...partial,
  };
}

/** In-memory stand-in for the three SQL reads, applying the same filter and keyset semantics. */
function fakeStore(events: StoredEvent[], checkpoint: { height: number; hash: string } | null) {
  const blocks = new Map([
    [100, HASH_100],
    [101, HASH_101],
  ]);
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM tandem_checkpoints")) return checkpoint ? [checkpoint] : [];
    if (sql.includes("FROM tandem_blocks")) {
      const hash = blocks.get(params[0] as number);
      return hash ? [{ hash }] : [];
    }
    if (sql.includes("FROM tandem_events")) {
      const [height, classA, classB, ...rest] = params as number[];
      const limit = rest.pop() as number;
      const after = rest.length ? [rest[0], rest[2], rest[4]] : null;
      const key = (e: StoredEvent) => [e.txIndex, e.eventIndex, e.subIndex];
      const greater = (a: number[], b: number[]) => {
        for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
        return false;
      };
      return events
        .filter((e) => e.blockHeight === height)
        .filter((e) => e.validityClass === classA || e.validityClass === classB)
        .filter((e) => !after || greater(key(e), after as number[]))
        .sort((a, b) => (greater(key(a), key(b)) ? 1 : -1))
        .slice(0, limit)
        .map(({ blockHeight: _h, validityClass: _v, ...row }) => row);
    }
    throw new Error(`unexpected query ${sql}`);
  };
  const dataSource = {
    manager: { query },
    transaction: async (_isolation: string, work: (manager: unknown) => Promise<unknown>) =>
      work({ query }),
  };
  return { dataSource, calls };
}

const config = { get: () => ({ network: "signet" }) };

async function build(
  events: StoredEvent[],
  options: { ready?: boolean; checkpoint?: { height: number; hash: string } | null } = {},
) {
  const store = fakeStore(
    events,
    options.checkpoint === undefined ? { height: 101, hash: TIP_HASH } : options.checkpoint,
  );
  const readiness = {
    probe: async () => ({
      ready: options.ready ?? true,
      reasons: options.ready === false ? ["checkpoint_incomplete"] : [],
    }),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [ExplorerController],
    providers: [
      BlockEventsService,
      { provide: DataSource, useValue: store.dataSource },
      { provide: ConfigService, useValue: config },
      { provide: ReadinessService, useValue: readiness },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, "127.0.0.1");
  return { app, calls: store.calls };
}

async function get(
  app: INestApplication,
  path: string,
  query: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = new URL(path, await app.getUrl());
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await fetch(url);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("universe-block-events-v1", () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const blockEvents = [
    event({ txIndex: 1, eventType: 1, predecessorOutpoint: null }),
    event({
      txIndex: 0,
      eventIndex: 0,
      eventType: 0,
      objectKey: null,
      predecessorOutpoint: null,
      successorOutpoint: null,
    }),
    event({ txIndex: 2, eventIndex: 0xffff_ffff, eventType: 7, validityClass: 0, objectKey: null }),
    event({
      txIndex: 3,
      eventIndex: 0xffff_ffff,
      subIndex: 1,
      eventType: 6,
      validityClass: 2,
      successorOutpoint: null,
    }),
    event({
      txIndex: 3,
      eventIndex: 0xffff_ffff,
      subIndex: 0,
      eventType: 6,
      validityClass: 2,
      successorOutpoint: null,
    }),
    event({ txIndex: 4, eventType: 5, successorOutpoint: null }),
    event({ blockHeight: 101, txIndex: 9 }),
  ];

  it("returns applied canonical events for one block in block order", async () => {
    ({ app } = await build(blockEvents));
    const response = await get(app, "/v1/explorer/blocks/100/events");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      schemaVersion: "universe-block-events-v1",
      chain: "bitcoin",
      network: "signet",
      protocols: ["tandem"],
      height: "100",
      blockHash: HASH_100,
      indexed: true,
      checkpoint: { height: "101", hash: TIP_HASH },
      nextCursor: null,
      complete: true,
    });
    const events = response.body.events as Array<Record<string, unknown>>;
    expect(events.map((e) => [e.txIndex, e.operation])).toEqual([
      [0, "deploy"],
      [1, "mint"],
      [3, "unknown"],
      [3, "unknown"],
      [4, "unlock"],
    ]);
    expect(events.map((e) => e.eventId)).toEqual([
      `${tx(0)}:0:0`,
      `${tx(1)}:0:0`,
      `${tx(3)}:4294967295:0`,
      `${tx(3)}:4294967295:1`,
      `${tx(4)}:0:0`,
    ]);
    expect(events[0]).toMatchObject({ assetId: null, assetKind: "protocol-event" });
    expect(events[1]).toEqual({
      eventId: `${tx(1)}:0:0`,
      protocolId: "tandem",
      txid: tx(1),
      txIndex: 1,
      operation: "mint",
      assetId: OBJECT,
      ticker: null,
      displayName: null,
      assetKind: "non-fungible",
      amountAtomic: null,
      decimals: null,
      fromAddress: null,
      toAddress: null,
      inputOutpoint: null,
      outputOutpoint: `${tx(1)}:1`,
      inscriptionId: null,
    });
  });

  it("never returns invalid no-state events", async () => {
    ({ app } = await build(blockEvents));
    const response = await get(app, "/v1/explorer/blocks/100/events");
    const txIndexes = (response.body.events as Array<{ txIndex: number }>).map((e) => e.txIndex);
    expect(txIndexes).not.toContain(2);
  });

  it("pages with an opaque keyset cursor until complete", async () => {
    let calls: Array<{ sql: string; params: unknown[] }>;
    ({ app, calls } = await build(blockEvents));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await get(
        app,
        "/v1/explorer/blocks/100/events",
        cursor ? { limit: "2", cursor } : { limit: "2" },
      );
      expect(response.status).toBe(200);
      pages += 1;
      seen.push(...(response.body.events as Array<{ eventId: string }>).map((e) => e.eventId));
      cursor = response.body.nextCursor as string | null;
      expect(response.body.complete).toBe(cursor === null);
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const eventQueries = calls.filter((call) => call.sql.includes("FROM tandem_events"));
    expect(eventQueries.every((call) => call.params.at(-1) === 3)).toBe(true);
  });

  it("reports indexed false above the checkpoint", async () => {
    ({ app } = await build(blockEvents));
    const response = await get(app, "/v1/explorer/blocks/102/events");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      height: "102",
      blockHash: null,
      indexed: false,
      checkpoint: { height: "101", hash: TIP_HASH },
      events: [],
      nextCursor: null,
      complete: false,
    });
  });

  it.each([
    ["/v1/explorer/blocks/abc/events"],
    ["/v1/explorer/blocks/-1/events"],
    ["/v1/explorer/blocks/12345678901/events"],
    ["/v1/explorer/blocks/100/events?limit=0"],
    ["/v1/explorer/blocks/100/events?limit=501"],
    ["/v1/explorer/blocks/100/events?limit=1.5"],
    ["/v1/explorer/blocks/100/events?limit=1&limit=2"],
    ["/v1/explorer/blocks/100/events?cursor=garbage"],
    ["/v1/explorer/blocks/100/events?cursor="],
  ])("rejects %s with 400", async (path) => {
    ({ app } = await build(blockEvents));
    expect((await get(app, path)).status).toBe(400);
  });

  it("rejects cursors issued for another height or block", async () => {
    ({ app } = await build(blockEvents));
    const otherHeight = encodeBlockEventsCursor({
      height: 101,
      blockHash: HASH_101,
      txIndex: 0,
      eventIndex: 0,
      subIndex: 0,
    });
    const otherBranch = encodeBlockEventsCursor({
      height: 100,
      blockHash: "ee".repeat(32),
      txIndex: 0,
      eventIndex: 0,
      subIndex: 0,
    });
    for (const cursor of [otherHeight, otherBranch]) {
      const response = await get(app, "/v1/explorer/blocks/100/events", { cursor });
      expect(response.status).toBe(400);
    }
  });

  it("returns 503 when not ready, never an empty 200", async () => {
    ({ app } = await build(blockEvents, { ready: false }));
    expect((await get(app, "/v1/explorer/blocks/100/events")).status).toBe(503);
    expect((await get(app, "/v1/checkpoint")).status).toBe(503);
  });

  it("returns 503 when no checkpoint exists", async () => {
    ({ app } = await build(blockEvents, { checkpoint: null }));
    expect((await get(app, "/v1/explorer/blocks/100/events")).status).toBe(503);
  });

  it("serves the checkpoint at the root", async () => {
    ({ app } = await build(blockEvents));
    const response = await get(app, "/v1/checkpoint");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ height: "101", hash: TIP_HASH });
  });
});

describe("block events cursor", () => {
  const position = {
    height: 840000,
    blockHash: HASH_100,
    txIndex: 12,
    eventIndex: 0xffff_ffff,
    subIndex: 3,
  };

  it("round-trips only its own canonical encoding", () => {
    const cursor = encodeBlockEventsCursor(position);
    expect(decodeBlockEventsCursor(cursor)).toEqual(position);
    expect(decodeBlockEventsCursor(`${cursor}=`)).toBeNull();
    expect(decodeBlockEventsCursor(Buffer.from("tbe2:1:x").toString("base64url"))).toBeNull();
    expect(
      decodeBlockEventsCursor(Buffer.from(`tbe1:840000:${HASH_100}:012:0:0`).toString("base64url")),
    ).toBeNull();
    expect(
      decodeBlockEventsCursor(
        Buffer.from(`tbe1:840000:${HASH_100}:4294967296:0:0`).toString("base64url"),
      ),
    ).toBeNull();
  });
});
