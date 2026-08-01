import { Inject, Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { TandemReorgEntity } from "../database/entities.js";
import type { ReorgPlan, ReorgStore } from "./reorg.service.js";

export interface CanonicalTip {
  height: number;
  hash: string;
  chainedRoot: string;
}

export const CANONICAL_DELETE_ORDER = [
  "tandem_chapters",
  "tandem_carriers",
  "tandem_states",
  "tandem_conflicts",
  "tandem_objects",
  "tandem_checkpoints",
  "tandem_events",
  "tandem_transactions",
  "tandem_blocks",
] as const;

export interface DerivedStateRebuilder {
  rebuildAt(manager: EntityManager, ancestorHeight: number): Promise<void>;
}

@Injectable()
export class IndexerStore implements ReorgStore {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @Inject("DerivedStateRebuilder")
    private readonly rebuilder: DerivedStateRebuilder,
  ) {}

  async canonicalTip(): Promise<CanonicalTip | null> {
    const rows = (await this.dataSource.query(
      "SELECT height, hash, chained_root AS chainedRoot FROM tandem_blocks ORDER BY height DESC LIMIT 1",
    )) as Array<{ height: number; hash: string; chainedRoot: string }>;
    return rows[0] ?? null;
  }

  async blockHash(height: number): Promise<string | null> {
    const rows = (await this.dataSource.query(
      "SELECT hash FROM tandem_blocks WHERE height = ? LIMIT 1",
      [height],
    )) as Array<{ hash: string }>;
    return rows[0]?.hash ?? null;
  }

  async rollback(
    plan: ReorgPlan,
    journal: { oldTipHash: string; ancestorHash: string; newTipHash: string },
  ): Promise<void> {
    await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const tipRows = (await manager.query(
        "SELECT height, hash FROM tandem_blocks ORDER BY height DESC LIMIT 1 FOR UPDATE",
      )) as Array<{ height: number; hash: string }>;
      const tip = tipRows[0];
      if (!tip || tip.height !== plan.oldTipHeight || tip.hash !== journal.oldTipHash) {
        throw new Error("canonical tip changed before rollback lock");
      }
      const ancestorRows = (await manager.query(
        "SELECT hash FROM tandem_blocks WHERE height = ? FOR UPDATE",
        [plan.ancestorHeight],
      )) as Array<{ hash: string }>;
      if (ancestorRows[0]?.hash !== journal.ancestorHash) {
        throw new Error("configured reorg ancestor does not match canonical storage");
      }
      await manager.getRepository(TandemReorgEntity).insert({
        oldTipHeight: plan.oldTipHeight,
        oldTipHash: journal.oldTipHash,
        ancestorHeight: plan.ancestorHeight,
        ancestorHash: journal.ancestorHash,
        newTipHash: journal.newTipHash,
        rolledBackBlocks: plan.rollbackHeights.length,
      });
      await manager.query("DELETE FROM tandem_chapters WHERE block_height > ?", [
        plan.ancestorHeight,
      ]);
      await manager.query("DELETE FROM tandem_carriers WHERE created_height > ?", [
        plan.ancestorHeight,
      ]);
      await manager.query(
        "UPDATE tandem_carriers SET spent_height = NULL, spent_txid = NULL WHERE spent_height > ?",
        [plan.ancestorHeight],
      );
      await manager.query("DELETE FROM tandem_states WHERE created_height > ?", [
        plan.ancestorHeight,
      ]);
      await manager.query(
        "UPDATE tandem_states SET spent_height = NULL, spent_txid = NULL WHERE spent_height > ?",
        [plan.ancestorHeight],
      );
      await manager.query("DELETE FROM tandem_conflicts WHERE detected_height > ?", [
        plan.ancestorHeight,
      ]);
      await manager.query("DELETE FROM tandem_objects WHERE create_height > ?", [
        plan.ancestorHeight,
      ]);
      await manager.query("DELETE FROM tandem_checkpoints WHERE height > ?", [plan.ancestorHeight]);
      await manager.query("DELETE FROM tandem_blocks WHERE height > ?", [plan.ancestorHeight]);
      await this.rebuilder.rebuildAt(manager, plan.ancestorHeight);
    });
  }
}
