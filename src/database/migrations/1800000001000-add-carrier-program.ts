import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddCarrierProgram1800000001000 implements MigrationInterface {
  name = "AddCarrierProgram1800000001000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tandem_states
       ADD COLUMN carrier_program CHAR(64) CHARACTER SET ascii COLLATE ascii_bin
       GENERATED ALWAYS AS (
         LOWER(SHA2(UNHEX(CONCAT('5221', key_0, '21', key_1, '52ae')), 256))
       ) STORED AFTER key_1`,
    );
    await queryRunner.query(
      "CREATE INDEX ix_tandem_states_carrier_program ON tandem_states (carrier_program, created_height)",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP INDEX ix_tandem_states_carrier_program ON tandem_states");
    await queryRunner.query("ALTER TABLE tandem_states DROP COLUMN carrier_program");
  }
}
