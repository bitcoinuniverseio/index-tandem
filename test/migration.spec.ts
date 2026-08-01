import { describe, expect, it } from "vitest";
import { TANDEM_TABLES } from "../src/database/migrations/1800000000000-init-tandem.js";

describe("schema migration", () => {
  it("declares every canonical and overlay table", () => {
    expect(TANDEM_TABLES).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });
});
