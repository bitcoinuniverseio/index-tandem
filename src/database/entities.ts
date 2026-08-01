import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { bigintTransformer } from "./bigint.transformer.js";

@Entity("tandem_blocks")
@Unique("uq_tandem_blocks_hash", ["hash"])
export class TandemBlockEntity {
  @PrimaryColumn({ type: "int", unsigned: true })
  declare height: number;

  @Column({ type: "char", length: 64 })
  declare hash: string;

  @Column({ name: "previous_hash", type: "char", length: 64, nullable: true })
  declare previousHash: string | null;

  @Column({ name: "block_time", type: "bigint", unsigned: true, transformer: bigintTransformer })
  declare blockTime: bigint;

  @Column({ name: "event_root", type: "char", length: 64 })
  declare eventRoot: string;

  @Column({ name: "object_state_root", type: "char", length: 64 })
  declare objectStateRoot: string;

  @Column({ name: "chained_root", type: "char", length: 64 })
  declare chainedRoot: string;

  @Column({ name: "event_count", type: "int", unsigned: true })
  declare eventCount: number;
}

@Entity("tandem_transactions")
@Index("ix_tandem_transactions_block_order", ["blockHeight", "txIndex"], { unique: true })
export class TandemTransactionEntity {
  @PrimaryColumn({ type: "char", length: 64 })
  declare txid: string;

  @Column({ type: "char", length: 64 })
  declare wtxid: string;

  @Column({ name: "block_height", type: "int", unsigned: true })
  declare blockHeight: number;

  @Column({ name: "tx_index", type: "int", unsigned: true })
  declare txIndex: number;

  @Column({ type: "int" })
  declare version: number;

  @Column({ type: "int", unsigned: true })
  declare locktime: number;
}

@Entity("tandem_events")
@Index("ix_tandem_events_block_order", ["blockHeight", "txIndex", "eventIndex"], {
  unique: true,
})
@Index("ix_tandem_events_object", ["objectKey", "blockHeight"])
export class TandemEventEntity {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  declare id: string;

  @Column({ name: "block_height", type: "int", unsigned: true })
  declare blockHeight: number;

  @Column({ type: "char", length: 64 })
  declare txid: string;

  @Column({ name: "tx_index", type: "int", unsigned: true })
  declare txIndex: number;

  @Column({ name: "event_index", type: "int", unsigned: true })
  declare eventIndex: number;

  @Column({ name: "event_type", type: "tinyint", unsigned: true })
  declare eventType: number;

  @Column({ name: "validity_class", type: "tinyint", unsigned: true })
  declare validityClass: number;

  @Column({ type: "smallint", unsigned: true })
  declare reason: number;

  @Column({ name: "object_key", type: "char", length: 64 })
  declare objectKey: string;

  @Column({ name: "state_sequence", type: "int", unsigned: true })
  declare stateSequence: number;

  @Column({ name: "marker_payload", type: "varchar", length: 164, nullable: true })
  declare markerPayload: string | null;
}

@Entity("tandem_objects")
@Index("ix_tandem_objects_status_height", ["status", "createHeight"])
export class TandemObjectEntity {
  @PrimaryColumn({ name: "object_key", type: "char", length: 64 })
  declare objectKey: string;

  @Column({ name: "create_txid", type: "char", length: 64, unique: true })
  declare createTxid: string;

  @Column({ name: "create_height", type: "int", unsigned: true })
  declare createHeight: number;

  @Column({ type: "boolean" })
  declare founding: boolean;

  @Column({ type: "varchar", length: 24 })
  declare status: string;

  @Column({ name: "state_sequence", type: "int", unsigned: true })
  declare stateSequence: number;

  @Column({ name: "current_outpoint", type: "varchar", length: 73, nullable: true })
  declare currentOutpoint: string | null;

  @Column({ name: "key_0", type: "char", length: 66 })
  declare key0: string;

  @Column({ name: "key_1", type: "char", length: 66 })
  declare key1: string;

  @Column({ name: "terminal_txid", type: "char", length: 64, nullable: true })
  declare terminalTxid: string | null;

  @Column({ name: "chapter_count", type: "int", unsigned: true })
  declare chapterCount: number;
}

@Entity("tandem_states")
@Index("ix_tandem_states_object_sequence", ["objectKey", "sequence"], { unique: true })
export class TandemStateEntity {
  @PrimaryColumn({ type: "varchar", length: 73 })
  declare outpoint: string;

  @Column({ name: "object_key", type: "char", length: 64 })
  declare objectKey: string;

  @Column({ type: "int", unsigned: true })
  declare sequence: number;

  @Column({ name: "created_height", type: "int", unsigned: true })
  declare createdHeight: number;

  @Column({ name: "spent_height", type: "int", unsigned: true, nullable: true })
  declare spentHeight: number | null;

  @Column({ name: "spent_txid", type: "char", length: 64, nullable: true })
  declare spentTxid: string | null;

  @Column({ name: "key_0", type: "char", length: 66 })
  declare key0: string;

  @Column({ name: "key_1", type: "char", length: 66 })
  declare key1: string;
}

@Entity("tandem_carriers")
@Index("ix_tandem_carriers_object", ["objectKey", "createdHeight"])
export class TandemCarrierEntity {
  @PrimaryColumn({ type: "varchar", length: 73 })
  declare outpoint: string;

  @Column({ name: "object_key", type: "char", length: 64 })
  declare objectKey: string;

  @Column({ name: "created_height", type: "int", unsigned: true })
  declare createdHeight: number;

  @Column({ name: "spent_height", type: "int", unsigned: true, nullable: true })
  declare spentHeight: number | null;

  @Column({ name: "spent_txid", type: "char", length: 64, nullable: true })
  declare spentTxid: string | null;

  @Column({ name: "value_sats", type: "bigint", unsigned: true, transformer: bigintTransformer })
  declare valueSats: bigint;
}

@Entity("tandem_chapters")
@Index("ix_tandem_chapters_object_sequence", ["objectKey", "sequence"], { unique: true })
export class TandemChapterEntity {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  declare id: string;

  @Column({ name: "object_key", type: "char", length: 64 })
  declare objectKey: string;

  @Column({ type: "int", unsigned: true })
  declare sequence: number;

  @Column({ type: "char", length: 64, unique: true })
  declare txid: string;

  @Column({ name: "block_height", type: "int", unsigned: true })
  declare blockHeight: number;

  @Column({ type: "tinyint", unsigned: true })
  declare kind: number;

  @Column({ type: "char", length: 64 })
  declare commitment: string;
}

@Entity("tandem_checkpoints")
export class TandemCheckpointEntity {
  @PrimaryColumn({ type: "int", unsigned: true })
  declare height: number;

  @Column({ name: "block_hash", type: "char", length: 64 })
  declare blockHash: string;

  @Column({ name: "event_root", type: "char", length: 64 })
  declare eventRoot: string;

  @Column({ name: "object_state_root", type: "char", length: 64 })
  declare objectStateRoot: string;

  @Column({ name: "chained_root", type: "char", length: 64 })
  declare chainedRoot: string;

  @Column({
    name: "founding_created",
    type: "bigint",
    unsigned: true,
    transformer: bigintTransformer,
  })
  declare foundingCreated: bigint;

  @Column({ name: "all_objects", type: "bigint", unsigned: true, transformer: bigintTransformer })
  declare allObjects: bigint;

  @Column({
    name: "active_objects",
    type: "bigint",
    unsigned: true,
    transformer: bigintTransformer,
  })
  declare activeObjects: bigint;
}

@Entity("tandem_mempool")
@Index("ix_tandem_mempool_seen", ["lastSeenAt"])
export class TandemMempoolEntity {
  @PrimaryColumn({ type: "char", length: 64 })
  declare txid: string;

  @Column({ name: "wtxid", type: "char", length: 64 })
  declare wtxid: string;

  @Column({ type: "varchar", length: 24 })
  declare classification: string;

  @Column({ type: "smallint", unsigned: true, nullable: true })
  declare reason: number | null;

  @Column({ name: "raw_observation", type: "json" })
  declare rawObservation: Record<string, unknown>;

  @CreateDateColumn({ name: "first_seen_at", type: "datetime", precision: 3 })
  declare firstSeenAt: Date;

  @Column({ name: "last_seen_at", type: "datetime", precision: 3 })
  declare lastSeenAt: Date;
}

@Entity("tandem_conflicts")
@Index("ix_tandem_conflicts_status", ["resolved", "detectedHeight"])
export class TandemConflictEntity {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  declare id: string;

  @Column({ name: "detected_height", type: "int", unsigned: true })
  declare detectedHeight: number;

  @Column({ type: "varchar", length: 73 })
  declare outpoint: string;

  @Column({ name: "winner_txid", type: "char", length: 64, nullable: true })
  declare winnerTxid: string | null;

  @Column({ name: "loser_txid", type: "char", length: 64 })
  declare loserTxid: string;

  @Column({ type: "boolean", default: false })
  declare resolved: boolean;
}

@Entity("tandem_reorg_journal")
@Index("ix_tandem_reorg_detected", ["detectedAt"])
export class TandemReorgEntity {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  declare id: string;

  @Column({ name: "old_tip_height", type: "int", unsigned: true })
  declare oldTipHeight: number;

  @Column({ name: "old_tip_hash", type: "char", length: 64 })
  declare oldTipHash: string;

  @Column({ name: "ancestor_height", type: "int", unsigned: true })
  declare ancestorHeight: number;

  @Column({ name: "ancestor_hash", type: "char", length: 64 })
  declare ancestorHash: string;

  @Column({ name: "new_tip_hash", type: "char", length: 64 })
  declare newTipHash: string;

  @Column({ name: "rolled_back_blocks", type: "int", unsigned: true })
  declare rolledBackBlocks: number;

  @CreateDateColumn({ name: "detected_at", type: "datetime", precision: 3 })
  declare detectedAt: Date;
}

export const ENTITIES = [
  TandemBlockEntity,
  TandemTransactionEntity,
  TandemEventEntity,
  TandemObjectEntity,
  TandemStateEntity,
  TandemCarrierEntity,
  TandemChapterEntity,
  TandemCheckpointEntity,
  TandemMempoolEntity,
  TandemConflictEntity,
  TandemReorgEntity,
] as const;
