import { describe, expect, it, vi } from "vitest";
import { AddCarrierProgram1800000001000 } from "../src/database/migrations/1800000001000-add-carrier-program.js";

describe("carrier program migration", () => {
  it("adds an indexed stored projection and removes it cleanly", async () => {
    const queryRunner = { query: vi.fn(async (_sql: string) => undefined) };
    const migration = new AddCarrierProgram1800000001000();
    await migration.up(queryRunner as never);
    expect(queryRunner.query.mock.calls[0]?.[0]).toContain("GENERATED ALWAYS AS");
    expect(queryRunner.query.mock.calls[0]?.[0]).toContain("SHA2");
    expect(queryRunner.query.mock.calls[1]?.[0]).toContain("ix_tandem_states_carrier_program");

    queryRunner.query.mockClear();
    await migration.down(queryRunner as never);
    expect(queryRunner.query.mock.calls.map(([sql]) => sql)).toEqual([
      "DROP INDEX ix_tandem_states_carrier_program ON tandem_states",
      "ALTER TABLE tandem_states DROP COLUMN carrier_program",
    ]);
  });
});
