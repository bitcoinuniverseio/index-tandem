import { initialStateRoot } from "@bitcoinuniverse/tandem";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OnEvent } from "@nestjs/event-emitter";
import { DataSource } from "typeorm";
import { BitcoinRpcClient } from "../bitcoin/bitcoin-rpc.client.js";
import type { AppConfiguration } from "../config/configuration.js";
import {
  type Binding,
  type InitActivation,
  type ObjectRecord,
  type ReducedBlock,
  reduceBlock,
} from "./block-reducer.js";
import { DeploymentStateService } from "./deployment-state.service.js";
import { IndexerStore } from "./indexer.store.js";
import { ReorgService } from "./reorg.service.js";

const MAX_INIT_SCAN_PER_TICK = 50;

interface ObjectRow {
  objectKey: string;
  createTxid: string;
  createHeight: number | string;
  founding: number | string | boolean;
  status: string;
  stateSequence: number | string;
  currentOutpoint: string | null;
  currentHeight: number | string | null;
  key0: string;
  key1: string;
  terminalTxid: string | null;
  chapterCount: number | string;
}

interface InitRow {
  txid: string;
  height: number | string;
  blockHash: string;
  openHeight: number | string | null;
  closeHeight: number | string | null;
  valid: number | string | boolean;
  reason: number | string;
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

export function objectFromRow(row: ObjectRow): ObjectRecord {
  return {
    objectKey: row.objectKey,
    createTxid: row.createTxid,
    createHeight: Number(row.createHeight),
    founding: Boolean(Number(row.founding)),
    status: row.status as ObjectRecord["status"],
    stateSequence: Number(row.stateSequence),
    currentOutpoint: row.currentOutpoint,
    currentHeight: nullableNumber(row.currentHeight),
    key0: row.key0,
    key1: row.key1,
    terminalTxid: row.terminalTxid,
    chapterCount: Number(row.chapterCount),
  };
}

/**
 * Follows the Bitcoin Core best chain from the configured INIT confirmation block onward, applies
 * each block atomically, and rolls back through the undo journal on reorganization.
 */
@Injectable()
export class SyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SyncService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopping = false;
  private objects: Map<string, ObjectRecord> | null = null;
  private scanCursor: number | null = null;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<AppConfiguration, true>,
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(BitcoinRpcClient) private readonly rpc: BitcoinRpcClient,
    @Inject(IndexerStore) private readonly store: IndexerStore,
    @Inject(ReorgService) private readonly reorgs: ReorgService,
    @Inject(DeploymentStateService) private readonly state: DeploymentStateService,
  ) {}

  onApplicationBootstrap(): void {
    const deployment = this.config.get("deployment", { infer: true });
    this.state.setActivation(null, Boolean(deployment.initTxid));
    if (this.config.get("sync", { infer: true }).enabled) this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  @OnEvent("bitcoin.hashblock")
  wake(): void {
    if (!this.running) this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    const pollMs = this.config.get("sync", { infer: true }).pollIntervalMs;
    let delay = pollMs;
    try {
      const more = await this.syncOnce();
      this.state.lastError = null;
      this.state.lastSyncAt = new Date().toISOString();
      if (more) delay = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.lastError = message.slice(0, 500);
      this.logger.error({ event: "sync_failed", error: message });
      this.objects = null;
      delay = Math.max(pollMs, 5_000);
    } finally {
      this.running = false;
      this.schedule(delay);
    }
  }

  private binding(): Binding | null {
    const deployment = this.config.get("deployment", { infer: true });
    if (!deployment.initTxid || !deployment.namespace) return null;
    return {
      networkCode: deployment.networkCode,
      initTxid: deployment.initTxid,
      specHash: deployment.specHash,
      namespace: deployment.namespace,
    };
  }

  /** Runs one bounded step. Returns true when more work is immediately available. */
  async syncOnce(): Promise<boolean> {
    const info = await this.rpc.getBlockchainInfo();
    this.state.node = {
      chain: info.chain,
      height: info.blocks,
      hash: info.bestblockhash,
      initialBlockDownload: info.initialblockdownload,
    };
    const expected = this.config.get("bitcoin", { infer: true }).expectedChain;
    if (info.chain !== expected) {
      throw new Error(`Bitcoin Core chain ${info.chain} does not match ${expected}`);
    }
    const binding = this.binding();
    if (!binding) {
      this.state.setActivation(null, false);
      return false;
    }
    const activation = await this.loadActivation();
    this.state.setActivation(activation, true);
    this.checkConfiguredHeights(activation);
    const tip = await this.store.canonicalTip();
    if (tip && activation) {
      const nodeHash = tip.height <= info.blocks ? await this.rpc.getBlockHash(tip.height) : null;
      if (nodeHash !== tip.hash) {
        await this.rollbackToCommonAncestor(tip.height, tip.hash, activation.height);
        return true;
      }
    }
    let nextHeight: number;
    if (!activation) {
      const initHeight = await this.locateInit(binding.initTxid, info.blocks);
      if (initHeight === null) return false;
      nextHeight = initHeight;
    } else {
      nextHeight = (tip?.height ?? activation.height - 1) + 1;
    }
    return this.connectBatch(binding, activation, tip, nextHeight, info.blocks);
  }

  private checkConfiguredHeights(activation: InitActivation | null): void {
    const deployment = this.config.get("deployment", { infer: true });
    if (!activation) {
      this.state.initConfigMismatch = null;
      return;
    }
    const problems: string[] = [];
    if (deployment.initHeight !== null && deployment.initHeight !== activation.height) {
      problems.push(`TANDEM_INIT_HEIGHT ${deployment.initHeight} != chain ${activation.height}`);
    }
    if (deployment.openHeight !== null && deployment.openHeight !== activation.openHeight) {
      problems.push(`TANDEM_OPEN_HEIGHT ${deployment.openHeight} != INIT ${activation.openHeight}`);
    }
    if (deployment.closeHeight !== null && deployment.closeHeight !== activation.closeHeight) {
      problems.push(
        `TANDEM_CLOSE_HEIGHT ${deployment.closeHeight} != INIT ${activation.closeHeight}`,
      );
    }
    this.state.initConfigMismatch = problems.length ? problems.join("; ") : null;
  }

  private async loadActivation(): Promise<InitActivation | null> {
    const rows = (await this.dataSource.query(
      `SELECT txid, height, block_hash AS blockHash, open_height AS openHeight,
       close_height AS closeHeight, valid, reason FROM tandem_init WHERE id = 1`,
    )) as InitRow[];
    const row = rows[0];
    if (!row) return null;
    return {
      txid: row.txid,
      height: Number(row.height),
      blockHash: row.blockHash,
      openHeight: nullableNumber(row.openHeight),
      closeHeight: nullableNumber(row.closeHeight),
      valid: Boolean(Number(row.valid)),
      reason: Number(row.reason),
    };
  }

  private async loadObjects(): Promise<Map<string, ObjectRecord>> {
    if (this.objects) return this.objects;
    const rows = (await this.dataSource.query(
      `SELECT o.object_key AS objectKey, o.create_txid AS createTxid,
       o.create_height AS createHeight, o.founding, o.status, o.state_sequence AS stateSequence,
       o.current_outpoint AS currentOutpoint, s.created_height AS currentHeight,
       o.key_0 AS key0, o.key_1 AS key1, o.terminal_txid AS terminalTxid,
       o.chapter_count AS chapterCount
       FROM tandem_objects o LEFT JOIN tandem_states s ON s.outpoint = o.current_outpoint`,
    )) as ObjectRow[];
    this.objects = new Map(rows.map((row) => [row.objectKey, objectFromRow(row)]));
    return this.objects;
  }

  /**
   * Finds the configured INIT confirmation height. Uses the operator hint, then Core's mempool or
   * txindex, then a bounded forward scan of recent blocks for nodes without txindex.
   */
  private async locateInit(txid: string, nodeHeight: number): Promise<number | null> {
    const deployment = this.config.get("deployment", { infer: true });
    if (deployment.initHeight !== null && deployment.initHeight <= nodeHeight) {
      const hash = await this.rpc.getBlockHash(deployment.initHeight);
      if ((await this.rpc.getBlockTxids(hash)).includes(txid)) return deployment.initHeight;
    }
    try {
      const location = await this.rpc.getRawTransactionLocation(txid);
      if (location.blockhash) {
        const header = await this.rpc.getBlockHeader(location.blockhash);
        if (header.confirmations > 0) return header.height;
      } else {
        this.state.initSeenInMempool = true;
        this.scanCursor = Math.max(this.scanCursor ?? 0, nodeHeight);
        return null;
      }
    } catch {
      // Unknown to the mempool and no txindex hit: fall through to the block scan.
    }
    const depth = this.config.get("sync", { infer: true }).initScanDepth;
    this.scanCursor ??= Math.max(0, nodeHeight - depth);
    let scanned = 0;
    while (this.scanCursor <= nodeHeight && scanned < MAX_INIT_SCAN_PER_TICK) {
      const hash = await this.rpc.getBlockHash(this.scanCursor);
      if ((await this.rpc.getBlockTxids(hash)).includes(txid)) return this.scanCursor;
      this.scanCursor += 1;
      scanned += 1;
    }
    return null;
  }

  /**
   * Fetches up to `batchBlocks` blocks with bounded concurrency, reduces them in order, and commits
   * them in one transaction. Stops early at a broken parent link (a reorg in progress) or when the
   * expected INIT block does not contain the INIT. Returns true when more work is available.
   */
  private async connectBatch(
    binding: Binding,
    activation: InitActivation | null,
    tip: { hash: string; chainedRoot: string } | null,
    firstHeight: number,
    nodeHeight: number,
  ): Promise<boolean> {
    const { batchBlocks, fetchConcurrency } = this.config.get("sync", { infer: true });
    const lastHeight = Math.min(nodeHeight, firstHeight + batchBlocks - 1);
    const batch: ReducedBlock[] = [];
    let current = activation;
    let previousHash = tip?.hash ?? null;
    let previousRoot = tip
      ? Uint8Array.from(Buffer.from(tip.chainedRoot, "hex"))
      : initialStateRoot(Uint8Array.from(Buffer.from(binding.namespace, "hex")));
    let objects: Map<string, ObjectRecord> = await this.loadObjects();
    let broken = false;
    for (let start = firstHeight; start <= lastHeight && !broken && !this.stopping; ) {
      const end = Math.min(lastHeight, start + fetchConcurrency - 1);
      const heights = Array.from({ length: end - start + 1 }, (_, index) => start + index);
      const blocks = await Promise.all(
        heights.map(async (height) => this.rpc.getBlock(await this.rpc.getBlockHash(height))),
      );
      for (const block of blocks) {
        if (previousHash !== null && block.previousBlockHash !== previousHash) {
          broken = true;
          break;
        }
        if (!current && !block.transactions.some((tx) => tx.txid === binding.initTxid)) {
          this.scanCursor = null;
          broken = true;
          break;
        }
        const reduced = reduceBlock({ binding, activation: current, previousRoot, objects, block });
        batch.push(reduced);
        current = reduced.activation;
        previousHash = reduced.hash;
        previousRoot = Uint8Array.from(Buffer.from(reduced.chainedRoot, "hex"));
        objects = reduced.objects;
      }
      start = end + 1;
    }
    if (batch.length > 0) {
      await this.store.appendBlocks(batch);
      this.objects = objects;
      this.state.setActivation(current, true);
      for (const reduced of batch) {
        if (reduced.initConfirmed) {
          this.logger.log({
            event: "init_confirmed",
            height: reduced.height,
            valid: reduced.activation.valid,
            reason: reduced.activation.reason,
          });
        }
        if (reduced.events.length > 0) {
          this.logger.log({
            event: "block_events",
            height: reduced.height,
            events: reduced.events.length,
          });
        }
      }
    }
    if (broken) return current !== null;
    return lastHeight < nodeHeight;
  }

  private async rollbackToCommonAncestor(
    tipHeight: number,
    tipHash: string,
    initHeight: number,
  ): Promise<void> {
    let ancestor = initHeight - 1;
    for (let height = tipHeight - 1; height >= initHeight; height -= 1) {
      const stored = await this.store.blockHash(height);
      const nodeHash = await this.rpc.getBlockHash(height).catch(() => null);
      if (stored !== null && stored === nodeHash) {
        ancestor = height;
        break;
      }
    }
    const ancestorHash =
      ancestor >= initHeight ? ((await this.store.blockHash(ancestor)) ?? "") : "0".repeat(64);
    const newTipHash = (await this.rpc.getBlockchainInfo()).bestblockhash;
    this.logger.warn({ event: "reorg", tipHeight, ancestor });
    await this.reorgs.rollback(tipHeight, ancestor, initHeight, {
      oldTipHash: tipHash,
      ancestorHash,
      newTipHash,
    });
    this.objects = null;
    this.scanCursor = null;
  }
}
