import { Inject, Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { TandemReorgEntity } from "../database/entities.js";
import type { ObjectRecord, ReducedBlock } from "./block-reducer.js";
import type { ReorgPlan, ReorgStore } from "./reorg.service.js";

export interface CanonicalTip {
  height: number;
  hash: string;
  chainedRoot: string;
}

function parsePrior(value: unknown): ObjectRecord | null {
  if (value === null || value === undefined) return null;
  return (typeof value === "string" ? JSON.parse(value) : value) as ObjectRecord;
}

/** Writes one object row; used by block connection and by rollback restoration. */
export async function upsertObject(manager: EntityManager, record: ObjectRecord): Promise<void> {
  await manager.query(
    `INSERT INTO tandem_objects (object_key, create_txid, create_height, founding, status,
       state_sequence, current_outpoint, key_0, key_1, terminal_txid, chapter_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE founding = VALUES(founding), status = VALUES(status),
       state_sequence = VALUES(state_sequence), current_outpoint = VALUES(current_outpoint),
       key_0 = VALUES(key_0), key_1 = VALUES(key_1), terminal_txid = VALUES(terminal_txid),
       chapter_count = VALUES(chapter_count)`,
    [
      record.objectKey,
      record.createTxid,
      record.createHeight,
      record.founding,
      record.status,
      record.stateSequence,
      record.currentOutpoint,
      record.key0,
      record.key1,
      record.terminalTxid,
      record.chapterCount,
    ],
  );
}

@Injectable()
export class IndexerStore implements ReorgStore {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
  ) {}

  async canonicalTip(): Promise<CanonicalTip | null> {
    const rows = (await this.dataSource.query(
      "SELECT height, hash, chained_root AS chainedRoot FROM tandem_blocks ORDER BY height DESC LIMIT 1",
    )) as Array<{ height: number | string; hash: string; chainedRoot: string }>;
    const row = rows[0];
    return row
      ? { height: Number(row.height), hash: row.hash, chainedRoot: row.chainedRoot }
      : null;
  }

  async blockHash(height: number): Promise<string | null> {
    const rows = (await this.dataSource.query(
      "SELECT hash FROM tandem_blocks WHERE height = ? LIMIT 1",
      [height],
    )) as Array<{ hash: string }>;
    return rows[0]?.hash ?? null;
  }

  /** Connects one reduced block atomically: rows, object state, undo journal, and checkpoint. */
  appendBlock(block: ReducedBlock): Promise<void> {
    return this.appendBlocks([block]);
  }

  /** Connects consecutive reduced blocks in one transaction, in order. */
  appendBlocks(blocks: readonly ReducedBlock[]): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      for (const block of blocks) await this.writeBlock(manager, block);
    });
  }

  private async writeBlock(manager: EntityManager, block: ReducedBlock): Promise<void> {
    await manager.query(
      `INSERT INTO tandem_blocks (height, hash, previous_hash, block_time, event_root,
       object_state_root, chained_root, event_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        block.height,
        block.hash,
        block.previousHash,
        block.time,
        block.eventRoot,
        block.objectStateRoot,
        block.chainedRoot,
        block.events.length,
      ],
    );
    if (block.initConfirmed) {
      const init = block.activation;
      await manager.query(
        `INSERT INTO tandem_init (id, txid, height, block_hash, open_height, close_height, valid,
         reason) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
        [
          init.txid,
          init.height,
          init.blockHash,
          init.openHeight,
          init.closeHeight,
          init.valid,
          init.reason,
        ],
      );
    }
    for (const tx of block.transactions) {
      await manager.query(
        `INSERT INTO tandem_transactions (txid, wtxid, block_height, tx_index, version, locktime)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tx.txid, tx.wtxid, block.height, tx.txIndex, tx.version, tx.locktime >>> 0],
      );
    }
    for (const event of block.events) {
      await manager.query(
        `INSERT INTO tandem_events (block_height, txid, tx_index, event_index, sub_index,
         event_type, validity_class, reason, namespace, object_key, state_sequence,
         predecessor_outpoint, successor_outpoint, key_0, key_1, commitment, marker_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          block.height,
          event.txid,
          event.txIndex,
          event.eventIndex,
          event.subIndex,
          event.eventType,
          event.validityClass,
          event.reason,
          event.namespace,
          event.objectKey,
          event.stateSequence,
          event.predecessorOutpoint,
          event.successorOutpoint,
          event.key0,
          event.key1,
          event.commitment,
          event.markerPayload,
        ],
      );
    }
    for (const [objectKey, prior] of block.undo) {
      await manager.query(
        "INSERT INTO tandem_object_undo (height, object_key, prior) VALUES (?, ?, ?)",
        [block.height, objectKey, prior ? JSON.stringify(prior) : null],
      );
      const current = block.objects.get(objectKey);
      if (current) await upsertObject(manager, current);
    }
    for (const row of block.newStates) {
      await manager.query(
        `INSERT INTO tandem_states (outpoint, object_key, sequence, created_height, key_0, key_1)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [row.outpoint, row.objectKey, row.sequence, block.height, row.key0, row.key1],
      );
      await manager.query(
        `INSERT INTO tandem_carriers (outpoint, object_key, created_height, value_sats)
         VALUES (?, ?, ?, 20000)`,
        [row.outpoint, row.objectKey, block.height],
      );
    }
    for (const spent of block.spentOutpoints) {
      for (const table of ["tandem_states", "tandem_carriers"]) {
        await manager.query(
          `UPDATE ${table} SET spent_height = ?, spent_txid = ? WHERE outpoint = ?`,
          [block.height, spent.txid, spent.outpoint],
        );
      }
    }
    for (const chapter of block.chapters) {
      await manager.query(
        `INSERT INTO tandem_chapters (object_key, sequence, txid, block_height, kind, commitment)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          chapter.objectKey,
          chapter.sequence,
          chapter.txid,
          block.height,
          chapter.kind,
          chapter.commitment,
        ],
      );
    }
    await manager.query(
      `INSERT INTO tandem_checkpoints (height, block_hash, event_root, object_state_root,
       chained_root, founding_created, all_objects, active_objects) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        block.height,
        block.hash,
        block.eventRoot,
        block.objectStateRoot,
        block.chainedRoot,
        block.foundingCreated.toString(),
        block.allObjects.toString(),
        block.activeObjects.toString(),
      ],
    );
  }

  /**
   * Disconnects blocks above the ancestor in exact reverse order (spec 14.4). Each block's undo
   * journal restores the pre-block snapshot of every object that block touched.
   */
  async rollback(
    plan: ReorgPlan,
    journal: { oldTipHash: string; ancestorHash: string; newTipHash: string },
  ): Promise<void> {
    await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const tipRows = (await manager.query(
        "SELECT height, hash FROM tandem_blocks ORDER BY height DESC LIMIT 1 FOR UPDATE",
      )) as Array<{ height: number | string; hash: string }>;
      const tip = tipRows[0];
      if (!tip || Number(tip.height) !== plan.oldTipHeight || tip.hash !== journal.oldTipHash) {
        throw new Error("canonical tip changed before rollback lock");
      }
      const ancestorRows = (await manager.query(
        "SELECT hash FROM tandem_blocks WHERE height = ? FOR UPDATE",
        [plan.ancestorHeight],
      )) as Array<{ hash: string }>;
      if (ancestorRows[0] && ancestorRows[0].hash !== journal.ancestorHash) {
        throw new Error("configured reorg ancestor does not match canonical storage");
      }
      for (const height of plan.rollbackHeights) {
        const undo = (await manager.query(
          "SELECT object_key AS objectKey, prior FROM tandem_object_undo WHERE height = ? ORDER BY id DESC",
          [height],
        )) as Array<{ objectKey: string; prior: unknown }>;
        await manager.query("DELETE FROM tandem_chapters WHERE block_height = ?", [height]);
        await manager.query("DELETE FROM tandem_carriers WHERE created_height = ?", [height]);
        await manager.query("DELETE FROM tandem_states WHERE created_height = ?", [height]);
        for (const table of ["tandem_states", "tandem_carriers"]) {
          await manager.query(
            `UPDATE ${table} SET spent_height = NULL, spent_txid = NULL WHERE spent_height = ?`,
            [height],
          );
        }
        for (const entry of undo) {
          const prior = parsePrior(entry.prior);
          if (!prior) {
            await manager.query("DELETE FROM tandem_objects WHERE object_key = ?", [
              entry.objectKey,
            ]);
            continue;
          }
          await manager.query(
            `UPDATE tandem_objects SET founding = ?, status = ?, state_sequence = ?,
             current_outpoint = ?, key_0 = ?, key_1 = ?, terminal_txid = ?, chapter_count = ?
             WHERE object_key = ?`,
            [
              prior.founding,
              prior.status,
              prior.stateSequence,
              prior.currentOutpoint,
              prior.key0,
              prior.key1,
              prior.terminalTxid,
              prior.chapterCount,
              prior.objectKey,
            ],
          );
        }
        await manager.query("DELETE FROM tandem_blocks WHERE height = ?", [height]);
      }
      await manager.getRepository(TandemReorgEntity).insert({
        oldTipHeight: plan.oldTipHeight,
        oldTipHash: journal.oldTipHash,
        ancestorHeight: plan.ancestorHeight,
        ancestorHash: journal.ancestorHash,
        newTipHash: journal.newTipHash,
        rolledBackBlocks: plan.rollbackHeights.length,
      });
    });
  }
}
