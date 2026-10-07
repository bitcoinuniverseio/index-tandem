import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { BitcoinRpcClient } from "../bitcoin/bitcoin-rpc.client.js";
import type { AppConfiguration } from "../config/configuration.js";
import {
  type VerificationMetadata,
  VerifiedGatewayService,
} from "../verification/verified-gateway.service.js";
import { serializeApiValue } from "./serialization.js";

const HASH = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
interface Cursor {
  v: 1;
  snapshot: string;
  limit: number;
  height: number;
  key: string;
  offset: number;
}
interface ObjectRow {
  objectKey: string;
  createTxid: string;
  createHeight: number;
  founding: number;
  [key: string]: unknown;
}
const COLUMNS = `object_key AS objectKey, create_txid AS createTxid, create_height AS createHeight,
 founding, status, state_sequence AS stateSequence, current_outpoint AS currentOutpoint,
 key_0 AS key0, key_1 AS key1, terminal_txid AS terminalTxid, chapter_count AS chapterCount`;

function safeCount(value: unknown): number {
  const text = String(value);
  if (!DECIMAL.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new ServiceUnavailableException("catalog counter is invalid");
  }
  return Number(text);
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function equalText(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Complete canonical object membership and observed carrier state, not custody or spend authorization. */
@Injectable()
export class TandemCatalogService {
  private inFlight = 0;
  constructor(
    @Inject(DataSource) private readonly source: DataSource,
    @Inject(ConfigService) private readonly config: ConfigService<AppConfiguration, true>,
    @Inject(VerifiedGatewayService) private readonly gateway: VerifiedGatewayService,
    @Inject(BitcoinRpcClient) private readonly rpc: BitcoinRpcClient,
  ) {}

  private cursor(raw: unknown, secret: string, limit: number): Cursor | null {
    if (raw === undefined) return null;
    if (
      typeof raw !== "string" ||
      raw.length > 2048 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw)
    ) {
      throw new BadRequestException("invalid catalog cursor");
    }
    const [payload, mac] = raw.split(".");
    if (
      !payload ||
      !mac ||
      !equalText(createHmac("sha256", secret).update(payload).digest("base64url"), mac)
    ) {
      throw new BadRequestException("invalid catalog cursor");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new BadRequestException("invalid catalog cursor");
    }
    const c = parsed as Cursor;
    if (
      !c ||
      typeof c !== "object" ||
      Array.isArray(c) ||
      Object.keys(c).sort().join(",") !== "height,key,limit,offset,snapshot,v" ||
      c.v !== 1 ||
      c.limit !== limit ||
      !HASH.test(c.snapshot) ||
      !HASH.test(c.key) ||
      !Number.isSafeInteger(c.height) ||
      c.height < 0 ||
      !Number.isSafeInteger(c.offset) ||
      c.offset < 1 ||
      Buffer.from(payload, "base64url").toString("base64url") !== payload
    ) {
      throw new BadRequestException("invalid catalog cursor");
    }
    return c;
  }

  async page(authorization: unknown, rawLimit: unknown, rawCursor: unknown) {
    const catalog = this.config.get("catalog", { infer: true });
    if (!catalog) throw new ServiceUnavailableException("catalog is not configured");
    if (typeof authorization !== "string" || !equalText(authorization, `Bearer ${catalog.token}`)) {
      throw new UnauthorizedException("catalog authorization required");
    }
    const text = rawLimit === undefined ? "50" : rawLimit;
    if (typeof text !== "string" || !/^[1-9][0-9]{0,2}$/.test(text) || Number(text) > 200) {
      throw new BadRequestException("limit must be between 1 and 200");
    }
    const limit = Number(text),
      cursor = this.cursor(rawCursor, catalog.cursorSecret, limit);
    if (this.inFlight >= 2) throw new ServiceUnavailableException("catalog is busy");
    this.inFlight++;
    const deadline = performance.now() + 15_000;
    const checkDeadline = () => {
      if (performance.now() >= deadline)
        throw new ServiceUnavailableException("catalog deadline exceeded");
    };
    const work = this.gateway
      .executeBound(async (verification) => {
        checkDeadline();
        const page = await this.readSnapshot(verification, limit, cursor, checkDeadline);
        checkDeadline();
        if ((await this.rpc.getBlockHash(verification.height)) !== verification.blockHash) {
          throw new ServiceUnavailableException("catalog checkpoint is not canonical");
        }
        checkDeadline();
        const last = page.items.at(-1);
        const next =
          page.hasMore && last
            ? {
                v: 1 as const,
                snapshot: page.snapshotHash,
                limit,
                height: last.createHeight,
                key: last.objectKey,
                offset: page.offset + page.items.length,
              }
            : null;
        const payload = next ? Buffer.from(JSON.stringify(next)).toString("base64url") : null;
        return serializeApiValue({
          ...page,
          nextCursor: payload
            ? `${payload}.${createHmac("sha256", catalog.cursorSecret).update(payload).digest("base64url")}`
            : null,
        });
      })
      .finally(() => {
        this.inFlight--;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new ServiceUnavailableException("catalog deadline exceeded")),
            15_000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async readSnapshot(
    verification: VerificationMetadata,
    limit: number,
    cursor: Cursor | null,
    checkDeadline: () => void,
  ) {
    const runner = this.source.createQueryRunner();
    try {
      await runner.connect();
      checkDeadline();
      await runner.startTransaction("REPEATABLE READ");
      checkDeadline();
      const tips = (await runner.query(`SELECT height, hash, event_root AS eventRoot,
        object_state_root AS objectStateRoot, chained_root AS chainedRoot
        FROM tandem_blocks ORDER BY height DESC LIMIT 1`)) as Array<Record<string, unknown>>;
      checkDeadline();
      const epochs = (await runner.query(
        "SELECT CAST(COALESCE(MAX(id),0) AS CHAR) AS epoch FROM tandem_reorg_journal",
      )) as Array<{ epoch: string }>;
      checkDeadline();
      const counts = (await runner.query(`SELECT CAST(COUNT(*) AS CHAR) AS total,
        CAST(COALESCE(SUM(founding),0) AS CHAR) AS founding,
        CAST(COALESCE(SUM(status='active'),0) AS CHAR) AS active FROM tandem_objects`)) as Array<{
        total: string;
        founding: string;
        active: string;
      }>;
      checkDeadline();
      const tip = tips[0],
        count = counts[0];
      if (
        !tip ||
        !count ||
        Number(tip.height) !== verification.height ||
        tip.hash !== verification.blockHash ||
        tip.eventRoot !== verification.eventRoot ||
        tip.objectStateRoot !== verification.objectStateRoot ||
        tip.chainedRoot !== verification.chainedRoot ||
        count.total !== verification.allObjects ||
        count.founding !== verification.foundingCreated ||
        count.active !== verification.activeObjects
      ) {
        throw new ServiceUnavailableException("catalog SQL state differs from signed agreement");
      }
      const total = safeCount(count.total),
        epoch = String(epochs[0]?.epoch);
      safeCount(epoch);
      const snapshotHash = digest({ verification, reorgEpoch: epoch, total });
      if (cursor && (cursor.snapshot !== snapshotHash || cursor.offset >= total)) {
        throw new ConflictException("catalog snapshot changed; restart pagination");
      }
      const rows = (await runner.query(
        `SELECT ${COLUMNS} FROM tandem_objects
        ${cursor ? "WHERE (create_height < ? OR (create_height = ? AND object_key > ?))" : ""}
        ORDER BY create_height DESC, object_key ASC LIMIT ${limit + 1}`,
        cursor ? [cursor.height, cursor.height, cursor.key] : [],
      )) as ObjectRow[];
      checkDeadline();
      const offset = cursor?.offset ?? 0,
        hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => ({
        ...row,
        founding: Boolean(Number(row.founding)),
        genesisOutpoint: `${row.createTxid}:1`,
        displayId: `tandem:${verification.network}:${verification.protocolId.split(":")[2]}:${row.createTxid}:1`,
      }));
      if (
        offset + items.length > total ||
        hasMore !== offset + items.length < total ||
        items.some((row, i) => {
          const previous = items[i - 1];
          return (
            !HASH.test(row.objectKey) ||
            !HASH.test(row.createTxid) ||
            !Number.isSafeInteger(row.createHeight) ||
            row.createHeight < 0 ||
            row.createHeight > verification.height ||
            (previous !== undefined &&
              (row.createHeight > previous.createHeight ||
                (row.createHeight === previous.createHeight &&
                  row.objectKey <= previous.objectKey)))
          );
        })
      ) {
        throw new ServiceUnavailableException("catalog page is inconsistent");
      }
      await runner.commitTransaction();
      return {
        schema: "tandem-verified-catalog-v1",
        scope: "complete-canonical-object-membership",
        snapshotHash,
        reorgEpoch: epoch,
        totalAtomic: count.total,
        offset,
        limit,
        items,
        hasMore,
      };
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }
}
