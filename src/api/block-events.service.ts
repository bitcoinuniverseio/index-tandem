import { EVENT_TYPE, VALIDITY_CLASS } from "@bitcoinuniverse/tandem";
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, type EntityManager } from "typeorm";
import type { AppConfiguration } from "../config/configuration.js";
import { ReadinessService } from "../observability/readiness.service.js";

export const BLOCK_EVENTS_SCHEMA = "universe-block-events-v1";
export const PROTOCOL_ID = "tandem";
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const CURSOR_VERSION = "tbe1";
const CURSOR_BODY =
  /^tbe1:(0|[1-9][0-9]{0,9}):([0-9a-f]{64}):(0|[1-9][0-9]{0,9}):(0|[1-9][0-9]{0,9}):(0|[1-9][0-9]{0,9})$/;
const U32_MAX = 0xffff_ffff;

/** Keyset position after the last returned event, bound to the block it was issued for. */
export interface BlockEventsCursor {
  height: number;
  blockHash: string;
  txIndex: number;
  eventIndex: number;
  subIndex: number;
}

export function encodeBlockEventsCursor(cursor: BlockEventsCursor): string {
  return Buffer.from(
    [
      CURSOR_VERSION,
      cursor.height,
      cursor.blockHash,
      cursor.txIndex,
      cursor.eventIndex,
      cursor.subIndex,
    ].join(":"),
  ).toString("base64url");
}

/** Accepts only the exact canonical encoding this service issues. */
export function decodeBlockEventsCursor(raw: string): BlockEventsCursor | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(raw)) return null;
  const body = Buffer.from(raw, "base64url").toString("latin1");
  const match = CURSOR_BODY.exec(body);
  if (!match) return null;
  const cursor = {
    height: Number(match[1]),
    blockHash: match[2] as string,
    txIndex: Number(match[3]),
    eventIndex: Number(match[4]),
    subIndex: Number(match[5]),
  };
  if (cursor.txIndex > U32_MAX || cursor.eventIndex > U32_MAX || cursor.subIndex > U32_MAX) {
    return null;
  }
  return encodeBlockEventsCursor(cursor) === raw ? cursor : null;
}

/**
 * Shared vocabulary for each stored event type. EXITED_NONCANONICAL terminates an object through a
 * spend that is not a Tandem operation, so it has no faithful shared name.
 */
const OPERATIONS: Record<number, string> = {
  [EVENT_TYPE.INIT]: "deploy",
  [EVENT_TYPE.CREATE]: "mint",
  [EVENT_TYPE.MARK]: "update",
  [EVENT_TYPE.ROTATE]: "update",
  [EVENT_TYPE.CLOSE]: "burn",
  [EVENT_TYPE.REFUND]: "unlock",
};

interface EventRow {
  txid: string;
  txIndex: number | string;
  eventIndex: number | string;
  subIndex: number | string;
  eventType: number | string;
  objectKey: string | null;
  predecessorOutpoint: string | null;
  successorOutpoint: string | null;
}

function checkedHeight(value: unknown): number {
  if (typeof value !== "string" || !/^[0-9]{1,10}$/.test(value)) {
    throw new BadRequestException("height must be an unsigned decimal of at most 10 digits");
  }
  return Number(value);
}

function checkedLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > MAX_LIMIT) {
    throw new BadRequestException(`limit must be between 1 and ${MAX_LIMIT}`);
  }
  return Number(value);
}

function checkedCursor(value: unknown, height: number): BlockEventsCursor | null {
  if (value === undefined) return null;
  const cursor = typeof value === "string" ? decodeBlockEventsCursor(value) : null;
  if (!cursor || cursor.height !== height) throw new BadRequestException("invalid cursor");
  return cursor;
}

@Injectable()
export class BlockEventsService {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppConfiguration, true>,
    @Inject(ReadinessService)
    private readonly readiness: ReadinessService,
  ) {}

  /** Same fail-closed rule as `GET /tandem/readiness`. */
  private async requireReady(): Promise<void> {
    const snapshot = await this.readiness.probe();
    if (!snapshot.ready) throw new ServiceUnavailableException(snapshot);
  }

  private async readCheckpoint(manager: EntityManager) {
    const rows = (await manager.query(
      "SELECT height, block_hash AS hash FROM tandem_checkpoints ORDER BY height DESC LIMIT 1",
    )) as Array<{ height: number | string; hash: string }>;
    const row = rows[0];
    if (!row) throw new ServiceUnavailableException("checkpoint unavailable");
    return { height: Number(row.height), hash: row.hash };
  }

  async checkpoint() {
    await this.requireReady();
    const checkpoint = await this.readCheckpoint(this.dataSource.manager);
    return { height: String(checkpoint.height), hash: checkpoint.hash };
  }

  async blockEvents(rawHeight: unknown, rawLimit: unknown, rawCursor: unknown) {
    const height = checkedHeight(rawHeight);
    const limit = checkedLimit(rawLimit);
    const cursor = checkedCursor(rawCursor, height);
    await this.requireReady();
    const deployment = this.config.get("deployment", { infer: true });
    return this.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const checkpoint = await this.readCheckpoint(manager);
      const base = {
        schemaVersion: BLOCK_EVENTS_SCHEMA,
        chain: "bitcoin",
        network: deployment.network,
        protocols: [PROTOCOL_ID],
        height: String(height),
      };
      const checkpointBody = { height: String(checkpoint.height), hash: checkpoint.hash };
      if (checkpoint.height < height) {
        if (cursor) throw new BadRequestException("invalid cursor");
        return {
          ...base,
          blockHash: null,
          indexed: false,
          checkpoint: checkpointBody,
          events: [],
          nextCursor: null,
          complete: false,
        };
      }
      const blocks = (await manager.query(
        "SELECT hash FROM tandem_blocks WHERE height = ? LIMIT 1",
        [height],
      )) as Array<{ hash: string }>;
      const blockHash = blocks[0]?.hash ?? null;
      if (cursor && cursor.blockHash !== blockHash) {
        throw new BadRequestException("cursor does not belong to the indexed block");
      }
      const rows = (await manager.query(
        `SELECT txid, tx_index AS txIndex, event_index AS eventIndex, sub_index AS subIndex,
         event_type AS eventType, object_key AS objectKey,
         predecessor_outpoint AS predecessorOutpoint, successor_outpoint AS successorOutpoint
         FROM tandem_events
         WHERE block_height = ? AND validity_class IN (?, ?)
         ${
           cursor
             ? `AND (tx_index > ? OR (tx_index = ? AND (event_index > ?
                OR (event_index = ? AND sub_index > ?))))`
             : ""
         }
         ORDER BY tx_index ASC, event_index ASC, sub_index ASC LIMIT ?`,
        [
          height,
          VALIDITY_CLASS.VALID_OPERATION,
          VALIDITY_CLASS.TERMINAL_NONCANONICAL,
          ...(cursor
            ? [
                cursor.txIndex,
                cursor.txIndex,
                cursor.eventIndex,
                cursor.eventIndex,
                cursor.subIndex,
              ]
            : []),
          limit + 1,
        ],
      )) as EventRow[];
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > limit && last && blockHash
          ? encodeBlockEventsCursor({
              height,
              blockHash,
              txIndex: Number(last.txIndex),
              eventIndex: Number(last.eventIndex),
              subIndex: Number(last.subIndex),
            })
          : null;
      return {
        ...base,
        blockHash,
        indexed: true,
        checkpoint: checkpointBody,
        events: page.map((row) => this.presentEvent(row)),
        nextCursor,
        complete: rows.length <= limit,
      };
    });
  }

  private presentEvent(row: EventRow) {
    const eventType = Number(row.eventType);
    const isInit = eventType === EVENT_TYPE.INIT;
    return {
      eventId: `${row.txid}:${Number(row.eventIndex)}:${Number(row.subIndex)}`,
      protocolId: PROTOCOL_ID,
      txid: row.txid,
      txIndex: Number(row.txIndex),
      operation: OPERATIONS[eventType] ?? "unknown",
      assetId: isInit ? null : row.objectKey,
      ticker: null,
      displayName: null,
      assetKind: isInit ? "protocol-event" : "non-fungible",
      amountAtomic: null,
      decimals: null,
      fromAddress: null,
      toAddress: null,
      inputOutpoint: row.predecessorOutpoint,
      outputOutpoint: row.successorOutpoint,
      inscriptionId: null,
    };
  }
}
