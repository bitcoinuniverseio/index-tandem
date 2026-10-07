import type { MigrationInterface, QueryRunner } from "typeorm";

const ASCII = "CHARACTER SET ascii COLLATE ascii_bin";

/**
 * Storage the live block engine needs: every event leaf field (spec 13.2) including `sub_index`,
 * which is part of event identity when one transaction consumes several carriers; the resolved
 * configured INIT; and the per-block object undo journal used for exact reverse-order rollback.
 */
export class LiveEngine1800000002000 implements MigrationInterface {
  name = "LiveEngine1800000002000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tandem_events
       ADD COLUMN sub_index INT UNSIGNED NOT NULL DEFAULT 0 AFTER event_index,
       ADD COLUMN namespace CHAR(64) ${ASCII} NOT NULL DEFAULT '' AFTER reason,
       MODIFY COLUMN object_key CHAR(64) ${ASCII} NULL,
       ADD COLUMN predecessor_outpoint VARCHAR(73) ${ASCII} NULL AFTER state_sequence,
       ADD COLUMN successor_outpoint VARCHAR(73) ${ASCII} NULL AFTER predecessor_outpoint,
       ADD COLUMN key_0 CHAR(66) ${ASCII} NULL AFTER successor_outpoint,
       ADD COLUMN key_1 CHAR(66) ${ASCII} NULL AFTER key_0,
       ADD COLUMN commitment CHAR(64) ${ASCII} NULL AFTER key_1,
       DROP INDEX ix_tandem_events_block_order,
       ADD UNIQUE KEY ix_tandem_events_block_order (block_height, tx_index, event_index, sub_index)`,
    );
    await queryRunner.query(
      `CREATE TABLE tandem_init (
        id TINYINT UNSIGNED NOT NULL,
        txid CHAR(64) ${ASCII} NOT NULL,
        height INT UNSIGNED NOT NULL,
        block_hash CHAR(64) ${ASCII} NOT NULL,
        open_height INT UNSIGNED NULL,
        close_height INT UNSIGNED NULL,
        valid BOOLEAN NOT NULL,
        reason SMALLINT UNSIGNED NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT fk_tandem_init_block FOREIGN KEY (height)
          REFERENCES tandem_blocks(height) ON DELETE CASCADE
      ) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE tandem_object_undo (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        height INT UNSIGNED NOT NULL,
        object_key CHAR(64) ${ASCII} NOT NULL,
        prior JSON NULL,
        PRIMARY KEY (id),
        KEY ix_tandem_object_undo_height (height),
        CONSTRAINT fk_tandem_object_undo_block FOREIGN KEY (height)
          REFERENCES tandem_blocks(height) ON DELETE CASCADE
      ) ENGINE=InnoDB`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE tandem_object_undo");
    await queryRunner.query("DROP TABLE tandem_init");
    await queryRunner.query(
      `ALTER TABLE tandem_events
       DROP INDEX ix_tandem_events_block_order,
       ADD UNIQUE KEY ix_tandem_events_block_order (block_height, tx_index, event_index),
       DROP COLUMN commitment, DROP COLUMN key_1, DROP COLUMN key_0,
       DROP COLUMN successor_outpoint, DROP COLUMN predecessor_outpoint,
       MODIFY COLUMN object_key CHAR(64) ${ASCII} NOT NULL,
       DROP COLUMN namespace, DROP COLUMN sub_index`,
    );
  }
}
