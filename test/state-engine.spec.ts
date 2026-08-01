import { describe, expect, it } from "vitest";
import { applyStateTransition, StateInvariantError } from "../src/protocol/state-engine.js";

const objectKey = "aa".repeat(32);
const firstOutpoint = "11".repeat(32) + ":1";
const secondOutpoint = "22".repeat(32) + ":1";

describe("applyStateTransition", () => {
  it("creates, marks, and closes one object without mutating prior snapshots", () => {
    const empty = new Map();
    const created = applyStateTransition(empty, {
      operation: "CREATE",
      objectKey,
      successorOutpoint: firstOutpoint,
      key0: "02" + "01".repeat(32),
      key1: "03" + "02".repeat(32),
    });
    const marked = applyStateTransition(created, {
      operation: "MARK",
      objectKey,
      sequence: 1,
      predecessorOutpoint: firstOutpoint,
      successorOutpoint: secondOutpoint,
      key0: created.get(objectKey)?.key0 ?? "",
      key1: created.get(objectKey)?.key1 ?? "",
    });
    const closed = applyStateTransition(marked, {
      operation: "CLOSE",
      objectKey,
      sequence: 2,
      predecessorOutpoint: secondOutpoint,
      terminalTxid: "33".repeat(32),
    });
    expect(empty.size).toBe(0);
    expect(created.get(objectKey)).toMatchObject({ sequence: 0, chapterCount: 0 });
    expect(marked.get(objectKey)).toMatchObject({ sequence: 1, chapterCount: 1 });
    expect(closed.get(objectKey)).toMatchObject({
      status: "closed",
      sequence: 2,
      currentOutpoint: null,
    });
  });

  it("rejects a skipped sequence and wrong predecessor", () => {
    const created = applyStateTransition(new Map(), {
      operation: "CREATE",
      objectKey,
      successorOutpoint: firstOutpoint,
      key0: "02" + "01".repeat(32),
      key1: "03" + "02".repeat(32),
    });
    expect(() =>
      applyStateTransition(created, {
        operation: "MARK",
        objectKey,
        sequence: 2,
        predecessorOutpoint: firstOutpoint,
        successorOutpoint: secondOutpoint,
        key0: "02" + "01".repeat(32),
        key1: "03" + "02".repeat(32),
      }),
    ).toThrow(StateInvariantError);
    expect(() =>
      applyStateTransition(created, {
        operation: "REFUND",
        objectKey,
        predecessorOutpoint: secondOutpoint,
        terminalTxid: "44".repeat(32),
      }),
    ).toThrow("predecessor outpoint");
  });
});
