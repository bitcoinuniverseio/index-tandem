import type { MigrationInterface, QueryRunner } from "typeorm";

export const TANDEM_TABLES = [
  "tandem_blocks",
  "tandem_transactions",
  "tandem_events",
  "tandem_objects",
  "tandem_states",
  "tandem_carriers",
  "tandem_chapters",
  "tandem_checkpoints",
  "tandem_mempool",
  "tandem_conflicts",
  "tandem_reorg_journal",
] as const;

const CREATE_STATEMENTS = [
  `CREATE TABLE tandem_blocks (
    height INT UNSIGNED NOT NULL,
    hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    previous_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    block_time BIGINT UNSIGNED NOT NULL,
    event_root CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    object_state_root CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    chained_root CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_count INT UNSIGNED NOT NULL,
    PRIMARY KEY (height), UNIQUE KEY uq_tandem_blocks_hash (hash)
  ) ENGINE=InnoDB`,
  `CREATE TABLE tandem_transactions (
    txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    wtxid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    block_height INT UNSIGNED NOT NULL,
    tx_index INT UNSIGNED NOT NULL,
    version INT NOT NULL,
    locktime INT UNSIGNED NOT NULL,
    PRIMARY KEY (txid),
    UNIQUE KEY ix_tandem_transactions_block_order (block_height, tx_index),
    CONSTRAINT fk_tandem_transactions_block FOREIGN KEY (block_height)
      REFERENCES tandem_blocks(height) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE tandem_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    block_height INT UNSIGNED NOT NULL,
    txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tx_index INT UNSIGNED NOT NULL,
    event_index INT UNSIGNED NOT NULL,
    event_type TINYINT UNSIGNED NOT NULL,
    validity_class TINYINT UNSIGNED NOT NULL,
    reason SMALLINT UNSIGNED NOT NULL,
    object_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state_sequence INT UNSIGNED NOT NULL,
    marker_payload VARCHAR(164) CHARACTER SET ascii COLLATE ascii_bin NULL,
    PRIMARY KEY (id),
    UNIQUE KEY ix_tandem_events_block_order (block_height, tx_index, event_index),
    KEY ix_tandem_events_object (object_key, block_height),
    KEY ix_tandem_events_txid (txid),
    CONSTRAINT fk_tandem_events_block FOREIGN KEY (block_height)
      REFERENCES tandem_blocks(height) ON DELETE CASCADE,
    CONSTRAINT fk_tandem_events_tx FOREIGN KEY (txid)
      REFERENCES tandem_transactions(txid) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE tandem_objects (
    object_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    create_txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    create_height INT UNSIGNED NOT NULL,
    founding BOOLEAN NOT NULL,
    status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state_sequence INT UNSIGNED NOT NULL,
    current_outpoint VARCHAR(73) CHARACTER SET ascii COLLATE ascii_bin NULL,
    key_0 CHAR(66) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    key_1 CHAR(66) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    terminal_txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    chapter_count INT UNSIGNED NOT NULL,
    PRIMARY KEY (object_key), UNIQUE KEY uq_tandem_objects_create (create_txid),
    KEY ix_tandem_objects_status_height (status, create_height)
  ) ENGINE=InnoDB`,
  `CREATE TABLE tandem_states (
    outpoint VARCHAR(73) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    object_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence INT UNSIGNED NOT NULL,
    created_height INT UNSIGNED NOT NULL,
    spent_height INT UNSIGNED NULL,
    spent_txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    key_0 CHAR(66) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    key_1 CHAR(66) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (outpoint),
    UNIQUE KEY ix_tandem_states_object_sequence (object_key, sequence),
    CONSTRAINT fk_tandem_states_object FOREIGN KEY (object_key)
      REFERENCES tandem_objects(object_key) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE tandem_carriers (
    outpoint VARCHAR(73) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    object_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_height INT UNSIGNED NOT NULL,
    spent_height INT UNSIGNED NULL,
    spent_txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    value_sats BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (outpoint), KEY ix_tandem_carriers_object (object_key, created_height),
    CONSTRAINT fk_tandem_carriers_object FOREIGN KEY (object_key)
      REFERENCES tandem_objects(object_key) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE tandem_chapters (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    object_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence INT UNSIGNED NOT NULL,
    txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    block_height INT UNSIGNED NOT NULL,
    kind TINYINT UNSIGNED NOT NULL,
    commitment CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_tandem_chapters_txid (txid),
    UNIQUE KEY ix_tandem_chapters_object_sequence (object_key, sequence),
    CONSTRAINT fk_tandem_chapters_object FOREIGN KEY (object_key)
      REFERENCES tandem_objects(object_key) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE tandem_checkpoints (
    height INT UNSIGNED NOT NULL,
    block_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_root CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    object_state_root CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    chained_root CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    founding_created BIGINT UNSIGNED NOT NULL,
    all_objects BIGINT UNSIGNED NOT NULL,
    active_objects BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (height),
    CONSTRAINT fk_tandem_checkpoints_block FOREIGN KEY (height)
      REFERENCES tandem_blocks(height) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE tandem_mempool (
    txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    wtxid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    classification VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reason SMALLINT UNSIGNED NULL,
    raw_observation JSON NOT NULL,
    first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_seen_at DATETIME(3) NOT NULL,
    PRIMARY KEY (txid), KEY ix_tandem_mempool_seen (last_seen_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE tandem_conflicts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    detected_height INT UNSIGNED NOT NULL,
    outpoint VARCHAR(73) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    winner_txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    loser_txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id), KEY ix_tandem_conflicts_status (resolved, detected_height)
  ) ENGINE=InnoDB`,
  `CREATE TABLE tandem_reorg_journal (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    old_tip_height INT UNSIGNED NOT NULL,
    old_tip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ancestor_height INT UNSIGNED NOT NULL,
    ancestor_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    new_tip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    rolled_back_blocks INT UNSIGNED NOT NULL,
    detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id), KEY ix_tandem_reorg_detected (detected_at)
  ) ENGINE=InnoDB`,
] as const;

export class InitTandemSchema1800000000000 implements MigrationInterface {
  name = "InitTandemSchema1800000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of CREATE_STATEMENTS) await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...TANDEM_TABLES].reverse()) {
      await queryRunner.query(`DROP TABLE ${table}`);
    }
  }
}
