import { EVENT_TYPE, initialStateRoot, REASON, VALIDITY_CLASS } from "@bitcoinuniverse/tandem";
import { describe, expect, it } from "vitest";
import { reduceBlock } from "../src/indexer/block-reducer.js";
import {
  CLOSE,
  INIT_HEIGHT,
  lifecycleFixture,
  OPEN,
  replay,
  SPEC_HASH,
} from "./support/lifecycle.js";

describe("live block engine", () => {
  const fixture = lifecycleFixture();
  const { binding, namespace, init, create, rotate, close, rotated, block } = fixture;
  const run = () => replay(fixture);

  it("validates the configured INIT and reads its heights from the payload", () => {
    const [initBlock] = run();
    expect(initBlock?.activation).toMatchObject({
      valid: true,
      height: INIT_HEIGHT,
      openHeight: OPEN,
      closeHeight: CLOSE,
    });
    expect(initBlock?.events).toEqual([
      expect.objectContaining({
        eventType: EVENT_TYPE.INIT,
        validityClass: VALIDITY_CLASS.VALID_OPERATION,
        commitment: SPEC_HASH,
        eventIndex: 0,
      }),
    ]);
  });

  it("applies CREATE, MARK, ROTATE, CLOSE and noncanonical exits with exact counters", () => {
    const [, created, marked, rotatedBlock, closed] = run();
    expect(created?.events.map((event) => [event.eventType, event.reason])).toEqual([
      [EVENT_TYPE.CREATE, REASON.VALID],
      [EVENT_TYPE.CREATE, REASON.VALID],
    ]);
    const objectKey = created?.events[0]?.objectKey as string;
    expect(created?.objects.get(objectKey)).toMatchObject({
      founding: true,
      status: "active",
      stateSequence: 0,
      currentOutpoint: `${create.txid}:1`,
    });
    expect(
      marked?.events.map((event) => [event.eventType, event.validityClass, event.reason]),
    ).toEqual([
      [EVENT_TYPE.MARK, VALIDITY_CLASS.VALID_OPERATION, REASON.VALID],
      [
        EVENT_TYPE.EXITED_NONCANONICAL,
        VALIDITY_CLASS.TERMINAL_NONCANONICAL,
        REASON.UNMARKED_CARRIER_SPEND,
      ],
    ]);
    expect(marked?.events[1]).toMatchObject({
      eventIndex: 0xffff_ffff,
      namespace: binding.namespace,
    });
    expect(marked?.objects.get(objectKey)).toMatchObject({ stateSequence: 1, chapterCount: 1 });
    expect(marked?.chapters).toEqual([
      expect.objectContaining({ sequence: 1, kind: 0, commitment: "07".repeat(32) }),
    ]);
    expect(rotatedBlock?.objects.get(objectKey)).toMatchObject({
      stateSequence: 2,
      key0: Buffer.from(rotated[0].publicKey).toString("hex"),
      key1: Buffer.from(rotated[1].publicKey).toString("hex"),
      currentOutpoint: `${rotate.txid}:1`,
      chapterCount: 1,
    });
    expect(closed?.events.map((event) => [event.eventType, event.reason])).toEqual([
      [EVENT_TYPE.CLOSE, REASON.VALID],
      [EVENT_TYPE.CREATE, REASON.VALID],
      [EVENT_TYPE.EXITED_NONCANONICAL, REASON.UNCONFIRMED_OR_SAME_BLOCK_PREVOUT],
    ]);
    expect(closed?.objects.get(objectKey)).toMatchObject({
      status: "closed",
      stateSequence: 3,
      currentOutpoint: null,
      terminalTxid: close.txid,
    });
    expect([closed?.foundingCreated, closed?.allObjects, closed?.activeObjects]).toEqual([
      3n,
      3n,
      0n,
    ]);
  });

  it("is deterministic across replays", () => {
    const first = run().map((item) => item.chainedRoot);
    const second = run().map((item) => item.chainedRoot);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it("records a FAILED_INIT and classifies nothing else while it stays canonical", () => {
    const failedBinding = { ...binding, specHash: "00".repeat(32) };
    const result = reduceBlock({
      binding: failedBinding,
      activation: null,
      previousRoot: initialStateRoot(namespace),
      objects: new Map(),
      block: block(INIT_HEIGHT, [init.view, create.view]),
    });
    expect(result.activation.valid).toBe(false);
    expect(result.events).toEqual([
      expect.objectContaining({
        eventType: EVENT_TYPE.INIT,
        validityClass: VALIDITY_CLASS.INVALID_NO_STATE,
        reason: REASON.UNSUPPORTED_OR_RESERVED_FIELD,
      }),
    ]);
  });
});
