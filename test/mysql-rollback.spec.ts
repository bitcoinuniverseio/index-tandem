import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfiguration } from "../src/config/configuration.js";
import { createDataSource } from "../src/database/data-source.js";
import { TANDEM_TABLES } from "../src/database/migrations/1800000000000-init-tandem.js";
import { IndexerStore } from "../src/indexer/indexer.store.js";
import { planReorgRollback } from "../src/indexer/reorg.service.js";
import { validEnvironment } from "./fixtures.js";
import { INIT_HEIGHT, lifecycleFixture, OPEN, replay } from "./support/lifecycle.js";

/**
 * Optional integration check against a disposable MySQL database. It runs only when
 * TANDEM_TEST_MYSQL_DATABASE names a database this test may wipe.
 */
const database = process.env.TANDEM_TEST_MYSQL_DATABASE;
const TABLES = [
  "tandem_blocks",
  "tandem_transactions",
  "tandem_events",
  "tandem_objects",
  "tandem_states",
  "tandem_carriers",
  "tandem_chapters",
  "tandem_checkpoints",
  "tandem_init",
  "tandem_object_undo",
];

describe.skipIf(!database)("MySQL connect and rollback", () => {
  const dataSource = createDataSource(
    loadConfiguration(
      validEnvironment({
        MYSQL_HOST: process.env.TANDEM_TEST_MYSQL_HOST ?? "127.0.0.1",
        MYSQL_PORT: process.env.TANDEM_TEST_MYSQL_PORT ?? "3306",
        MYSQL_USER: process.env.TANDEM_TEST_MYSQL_USER ?? "root",
        MYSQL_PASSWORD: process.env.TANDEM_TEST_MYSQL_PASSWORD ?? "unused",
        MYSQL_DATABASE: database ?? "unused",
      }),
    ),
  );
  const store = new IndexerStore(dataSource);

  async function dump(): Promise<Record<string, unknown[]>> {
    const result: Record<string, unknown[]> = {};
    for (const table of TABLES) {
      const rows = (await dataSource.query(`SELECT * FROM ${table}`)) as Array<
        Record<string, unknown>
      >;
      // Surrogate auto-increment ids legitimately differ after a replay.
      result[table] = rows
        .map(({ id: _id, ...rest }) => rest)
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    return result;
  }

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of [
      ...TANDEM_TABLES,
      "tandem_init",
      "tandem_object_undo",
      "tandem_migrations",
    ]) {
      await dataSource.query(`DROP TABLE IF EXISTS ${table}`);
    }
    await dataSource.query("SET FOREIGN_KEY_CHECKS = 1");
    await dataSource.runMigrations({ transaction: "all" });
  });

  afterAll(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  it("restores the exact post-ancestor rows and replays to identical roots", async () => {
    const reduced = replay(lifecycleFixture());
    const snapshots: Record<number, Record<string, unknown[]>> = {};
    for (const block of reduced) {
      await store.appendBlock(block);
      snapshots[block.height] = await dump();
    }
    const tip = reduced.at(-1);
    if (!tip) throw new Error("no blocks");
    await store.rollback(planReorgRollback(tip.height, OPEN, INIT_HEIGHT), {
      oldTipHash: tip.hash,
      ancestorHash: reduced[1]?.hash ?? "",
      newTipHash: "ff".repeat(32),
    });
    expect(await dump()).toEqual(snapshots[OPEN]);
    for (const block of reduced.slice(2)) await store.appendBlock(block);
    expect(await dump()).toEqual(snapshots[tip.height]);
    const current = await store.canonicalTip();
    await store.rollback(planReorgRollback(tip.height, INIT_HEIGHT - 1, INIT_HEIGHT), {
      oldTipHash: current?.hash ?? "",
      ancestorHash: "00".repeat(32),
      newTipHash: "ff".repeat(32),
    });
    const empty = await dump();
    for (const table of TABLES) expect(empty[table]).toEqual([]);
  }, 60_000);
});
