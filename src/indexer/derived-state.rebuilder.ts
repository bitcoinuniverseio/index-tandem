import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { DerivedStateRebuilder } from "./indexer.store.js";

@Injectable()
export class SqlDerivedStateRebuilder implements DerivedStateRebuilder {
  async rebuildAt(manager: EntityManager, ancestorHeight: number): Promise<void> {
    await manager.query(
      `UPDATE tandem_objects object_row
       LEFT JOIN (
         SELECT object_key, MAX(sequence) AS state_sequence
         FROM tandem_states WHERE created_height <= ? GROUP BY object_key
       ) latest ON latest.object_key = object_row.object_key
       LEFT JOIN tandem_states state_row
         ON state_row.object_key = latest.object_key AND state_row.sequence = latest.state_sequence
       SET object_row.state_sequence = COALESCE(latest.state_sequence, 0),
           object_row.current_outpoint = CASE WHEN state_row.spent_height IS NULL THEN state_row.outpoint ELSE NULL END,
           object_row.key_0 = COALESCE(state_row.key_0, object_row.key_0),
           object_row.key_1 = COALESCE(state_row.key_1, object_row.key_1),
           object_row.status = CASE WHEN state_row.spent_height IS NULL THEN 'active' ELSE object_row.status END,
           object_row.terminal_txid = CASE WHEN state_row.spent_height IS NULL THEN NULL ELSE object_row.terminal_txid END,
           object_row.chapter_count = (
             SELECT COUNT(*) FROM tandem_chapters chapter_row
             WHERE chapter_row.object_key = object_row.object_key AND chapter_row.block_height <= ?
           )`,
      [ancestorHeight, ancestorHeight],
    );
    const unresolved = (await manager.query(
      `SELECT object_key FROM tandem_objects
       WHERE current_outpoint IS NULL AND terminal_txid IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM tandem_events event_row
         WHERE event_row.object_key = tandem_objects.object_key
           AND event_row.block_height <= ? AND event_row.validity_class <> 0
           AND event_row.event_type IN (4, 5, 6)
       ) LIMIT 1`,
      [ancestorHeight],
    )) as unknown[];
    if (unresolved.length > 0) {
      throw new Error("derived state cannot be reconstructed at the selected ancestor");
    }
  }
}
