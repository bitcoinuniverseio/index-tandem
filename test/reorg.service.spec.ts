import { describe, expect, it } from "vitest";
import { planReorgRollback, ReorgBoundaryError } from "../src/indexer/reorg.service.js";

describe("planReorgRollback", () => {
  it("returns descending rollback heights and stops at the ancestor", () => {
    expect(planReorgRollback(1015, 1011, 1008)).toEqual({
      oldTipHeight: 1015,
      ancestorHeight: 1011,
      rollbackHeights: [1015, 1014, 1013, 1012],
    });
  });

  it("allows the boundary immediately before INIT", () => {
    expect(planReorgRollback(1009, 1007, 1008).rollbackHeights).toEqual([1009, 1008]);
  });

  it("rejects rollback below the configured deployment boundary", () => {
    expect(() => planReorgRollback(1010, 1006, 1008)).toThrow(ReorgBoundaryError);
  });
});
