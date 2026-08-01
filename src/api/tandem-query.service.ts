import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import type { AppConfiguration } from "../config/configuration.js";
import { serializeApiValue } from "./serialization.js";

const HASH = /^[0-9a-f]{64}$/;

function checkedHash(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (!HASH.test(normalized)) throw new BadRequestException(`${label} must be 32-byte hex`);
  return normalized;
}

function checkedLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new BadRequestException("limit must be between 1 and 200");
  }
  return limit;
}

@Injectable()
export class TandemQueryService {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}

  async status() {
    const deployment = this.config.get("deployment", { infer: true });
    const tips = (await this.dataSource.query(
      `SELECT height, hash, event_root AS eventRoot, object_state_root AS objectStateRoot,
       chained_root AS chainedRoot FROM tandem_blocks ORDER BY height DESC LIMIT 1`,
    )) as unknown[];
    const mempool = (await this.dataSource.query(
      "SELECT COUNT(*) AS count FROM tandem_mempool",
    )) as unknown[];
    return serializeApiValue({ deployment, canonicalTip: tips[0] ?? null, mempool: mempool[0] });
  }

  async object(objectKey: string) {
    const key = checkedHash(objectKey, "object key");
    const objects = (await this.dataSource.query(
      `SELECT object_key AS objectKey, create_txid AS createTxid, create_height AS createHeight,
       founding, status, state_sequence AS stateSequence, current_outpoint AS currentOutpoint,
       key_0 AS key0, key_1 AS key1, terminal_txid AS terminalTxid,
       chapter_count AS chapterCount FROM tandem_objects WHERE object_key = ? LIMIT 1`,
      [key],
    )) as unknown[];
    if (!objects[0]) throw new NotFoundException("object not found");
    const chapters = await this.dataSource.query(
      `SELECT sequence, txid, block_height AS blockHeight, kind, commitment
       FROM tandem_chapters WHERE object_key = ? ORDER BY sequence ASC`,
      [key],
    );
    return serializeApiValue({ object: objects[0], chapters });
  }

  async carrier(txid: string, vout: number) {
    const checkedTxid = checkedHash(txid, "txid");
    if (!Number.isSafeInteger(vout) || vout < 0 || vout > 0xffff_ffff) {
      throw new BadRequestException("vout is invalid");
    }
    const rows = (await this.dataSource.query(
      `SELECT outpoint, object_key AS objectKey, created_height AS createdHeight,
       spent_height AS spentHeight, spent_txid AS spentTxid,
       CAST(value_sats AS CHAR) AS valueSats
       FROM tandem_carriers WHERE outpoint = ? LIMIT 1`,
      [`${checkedTxid}:${vout}`],
    )) as unknown[];
    if (!rows[0]) throw new NotFoundException("carrier not found");
    return serializeApiValue(rows[0]);
  }

  async events(txid: string) {
    const checkedTxid = checkedHash(txid, "txid");
    const rows = await this.dataSource.query(
      `SELECT block_height AS blockHeight, txid, tx_index AS txIndex,
       event_index AS eventIndex, event_type AS eventType, validity_class AS validityClass,
       reason, object_key AS objectKey, state_sequence AS stateSequence,
       marker_payload AS markerPayload
       FROM tandem_events WHERE txid = ? ORDER BY event_index ASC`,
      [checkedTxid],
    );
    return serializeApiValue({ txid: checkedTxid, events: rows });
  }

  async invalidEvents(limit: number) {
    const rows = await this.dataSource.query(
      `SELECT block_height AS blockHeight, txid, tx_index AS txIndex,
       event_index AS eventIndex, event_type AS eventType, reason,
       marker_payload AS markerPayload FROM tandem_events
       WHERE validity_class = 0 ORDER BY block_height DESC, tx_index DESC, event_index DESC LIMIT ?`,
      [checkedLimit(limit)],
    );
    return serializeApiValue({ items: rows });
  }

  async reorgs(limit: number) {
    const rows = await this.dataSource.query(
      `SELECT CAST(id AS CHAR) AS id, old_tip_height AS oldTipHeight,
       old_tip_hash AS oldTipHash, ancestor_height AS ancestorHeight,
       ancestor_hash AS ancestorHash, new_tip_hash AS newTipHash,
       rolled_back_blocks AS rolledBackBlocks, detected_at AS detectedAt
       FROM tandem_reorg_journal ORDER BY id DESC LIMIT ?`,
      [checkedLimit(limit)],
    );
    return serializeApiValue({ items: rows });
  }

  async stats() {
    const rows = (await this.dataSource.query(
      `SELECT
       (SELECT COUNT(*) FROM tandem_objects) AS allObjects,
       (SELECT COUNT(*) FROM tandem_objects WHERE status = 'active') AS activeObjects,
       (SELECT COUNT(*) FROM tandem_objects WHERE founding = TRUE) AS foundingObjects,
       (SELECT COUNT(*) FROM tandem_chapters) AS chapters,
       (SELECT COUNT(*) FROM tandem_events WHERE validity_class = 0) AS invalidEvents,
       (SELECT COUNT(*) FROM tandem_conflicts WHERE resolved = FALSE) AS unresolvedConflicts`,
    )) as unknown[];
    return serializeApiValue(rows[0] ?? {});
  }
}
