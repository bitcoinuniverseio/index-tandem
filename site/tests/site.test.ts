/**
 * Tests for the logic the documentation site owns.
 *
 * Two of these matter more than the rest:
 *   - the address encoder is pinned against output produced by the indexer's
 *     own `src/api/carrier-address.ts`, so a teaching model can never show an
 *     address the real service would reject
 *   - the state machine is pinned against the rules in the indexer's
 *     `src/protocol/state-engine.ts`
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { inspectEnvelope } from "../src/lib/agreement.ts";
import { ogSlugFromPathname } from "../src/lib/og.ts";
import {
  applyOperation,
  CARRIER_VALUE,
  createObject,
  REASONS,
  REFUND_DELAY,
  encodeCarrierAddress as encode,
  namespaceCommitment,
  reasonName,
  standInKey,
} from "../src/lib/tandem.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, "..");

const DEPLOYMENT = { network: "regtest" as const, openHeight: 2016, closeHeight: 6336 };

test("social preview slugs are stable and collision free", () => {
  assert.equal(ogSlugFromPathname("/index-tandem/", "/index-tandem"), "index");
  assert.equal(ogSlugFromPathname("/index-tandem", "/index-tandem"), "index");
  assert.equal(
    ogSlugFromPathname("/index-tandem/build/api-reference/", "/index-tandem"),
    "build__api-reference",
  );
  assert.equal(
    ogSlugFromPathname("/index-tandem/operate/bitcoin-core/", "/index-tandem"),
    "operate__bitcoin-core",
  );
  assert.notEqual(
    ogSlugFromPathname("/index-tandem/a/b/", "/index-tandem"),
    ogSlugFromPathname("/index-tandem/a-b/", "/index-tandem"),
  );
});

test("carrier addresses match the indexer's own encoder", () => {
  // Produced by running src/api/carrier-address.ts in the indexer.
  const program = "a".repeat(64);
  assert.equal(
    encode(program, "mainnet"),
    "bc1q424242424242424242424242424242424242424242424242424q5vl6dv",
  );
  assert.equal(
    encode(program, "signet"),
    "tb1q424242424242424242424242424242424242424242424242424qryf4hr",
  );
  assert.equal(
    encode(program, "testnet4"),
    "tb1q424242424242424242424242424242424242424242424242424qryf4hr",
  );
  assert.equal(
    encode(program, "regtest"),
    "bcrt1q424242424242424242424242424242424242424242424242424qwarnze",
  );

  const second = "0123456789abcdef".repeat(4);
  assert.equal(
    encode(second, "mainnet"),
    "bc1qqy352euf40x77qfrg4ncn27dauqjx3t83x4ummcpydzk0zdtehhszw4r45",
  );
  assert.equal(
    encode(second, "regtest"),
    "bcrt1qqy352euf40x77qfrg4ncn27dauqjx3t83x4ummcpydzk0zdtehhsclf26p",
  );
});

test("stand-in keys look like compressed secp256k1 points", () => {
  for (const seed of ["a", "b", "c", "d", "e"]) {
    const key = standInKey(seed);
    assert.equal(key.length, 66);
    assert.ok(key.startsWith("02") || key.startsWith("03"), `${key} has no valid prefix`);
    assert.match(key, /^[0-9a-f]{66}$/);
  }
});

test("a founded object starts at sequence zero with no chapters", () => {
  const object = createObject("t", DEPLOYMENT, 2100);
  assert.equal(object.sequence, 0);
  assert.equal(object.chapterCount, 0);
  assert.equal(object.status, "active");
  assert.equal(object.founding, true);
  assert.ok(object.key0 < object.key1, "keys must be sorted");
  assert.equal(object.currentOutpoint, `${object.createTxid}:1`);
});

test("founding status follows the open and close heights", () => {
  assert.equal(createObject("t", DEPLOYMENT, 2015).founding, false);
  assert.equal(createObject("t", DEPLOYMENT, 2016).founding, true);
  assert.equal(createObject("t", DEPLOYMENT, 6335).founding, true);
  assert.equal(createObject("t", DEPLOYMENT, 6336).founding, false);
});

test("only a chapter increments the chapter count", () => {
  let object = createObject("t", DEPLOYMENT, 2100);
  object = applyOperation(object, "MARK", { seed: "t", height: 2110 }).object;
  assert.equal(object.sequence, 1);
  assert.equal(object.chapterCount, 1);

  const keysBefore = [object.key0, object.key1];
  object = applyOperation(object, "ROTATE", { seed: "t", height: 2120 }).object;
  assert.equal(object.sequence, 2, "rotation advances the sequence");
  assert.equal(object.chapterCount, 1, "rotation must not touch the chapter count");
  assert.notDeepEqual([object.key0, object.key1], keysBefore, "rotation must change the keys");
  assert.ok(object.key0 < object.key1, "the successor pair stays sorted");
});

test("a cooperative close advances the sequence and terminates", () => {
  let object = createObject("t", DEPLOYMENT, 2100);
  object = applyOperation(object, "MARK", { seed: "t", height: 2110 }).object;
  const before = object.sequence;
  object = applyOperation(object, "CLOSE", { seed: "t", height: 2120 }).object;
  assert.equal(object.status, "closed");
  assert.equal(object.sequence, before + 1);
  assert.equal(object.currentOutpoint, null);
  assert.ok(object.terminalTxid);
});

test("recovery and a non-canonical exit leave the sequence where it is", () => {
  for (const operation of ["REFUND", "BREAK"] as const) {
    let object = createObject("t", DEPLOYMENT, 2100);
    object = applyOperation(object, "MARK", { seed: "t", height: 2110 }).object;
    const before = object.sequence;
    object = applyOperation(object, operation, { seed: "t", height: 2120 }).object;
    assert.equal(object.sequence, before, `${operation} must not increment the sequence`);
    assert.equal(object.currentOutpoint, null);
    assert.equal(object.status, operation === "REFUND" ? "refunded" : "exited_noncanonical");
  }
});

test("a terminal object accepts no further operation", () => {
  let object = createObject("t", DEPLOYMENT, 2100);
  object = applyOperation(object, "CLOSE", { seed: "t", height: 2110 }).object;
  const after = applyOperation(object, "MARK", { seed: "t", height: 2120 });
  assert.deepEqual(after.object, object, "state must not change");
  assert.match(after.note, /terminal/i);
});

test("the reason registry is exhaustive and matches the canonical package", () => {
  assert.equal(REASONS.length, 26, "the registry has exactly 26 entries");
  assert.equal(reasonName(0x0000), "VALID");
  assert.equal(reasonName(0x001f), "BAD_REFUND_SHAPE_OR_MATURITY");
  assert.equal(reasonName(0x0020), "MULTIPLE_CARRIERS");
  assert.equal(reasonName(0x0030), "UNMARKED_CARRIER_SPEND");
  // The registry has deliberate gaps. Nothing may fill them.
  for (const code of [0x0008, 0x000f, 0x0021, 0x002f]) {
    assert.equal(reasonName(code), "UNKNOWN", `0x${code.toString(16)} must stay unused`);
  }
  const codes = REASONS.map((entry) => entry.code);
  assert.equal(new Set(codes).size, codes.length, "codes are unique");
  assert.deepEqual(codes, [...codes].sort((a, b) => a - b), "codes are ordered");
});

test("protocol constants match the specification", () => {
  assert.equal(CARRIER_VALUE, 20_000);
  assert.equal(REFUND_DELAY, 52_560);
});

test("the namespace calculator matches the canonical package", async () => {
  // Produced by @bitcoinuniverse/tandem's own namespaceCommitment for
  // init txid 0x11 repeated and spec hash 0x22 repeated. The regtest value is
  // the same literal the indexer pins in test/configuration.spec.ts.
  const init = "11".repeat(32);
  const spec = "22".repeat(32);
  const expected = {
    mainnet: "35ba10216c4425030c8369ca68ebbf5e5bd77eed0ff01fc9cd4d438edf5035f2",
    signet: "164e6213a5aac85e2bfc0b401d2a61cdc623019d7f728e19696ddab078458978",
    testnet4: "e88818e780d19dfa26d1548f69baec8f124d2cd78801f66de7c5b167c8ccb788",
    regtest: "64f11c19b8960b6565b50da4fdbbe4262c3929b216cd6a91446f91f1c4e6e44c",
  } as const;
  for (const [network, digest] of Object.entries(expected)) {
    assert.equal(
      await namespaceCommitment(network as keyof typeof expected, init, spec),
      digest,
      `${network} namespace commitment`,
    );
  }
});

test("the envelope inspector agrees with the gateway's checks", () => {
  const wellFormed = {
    schema: "urn:tandem:agreement-envelope",
    key_id: "pipeline-a-2026-01",
    tuple: {
      schema: "urn:tandem:agreement-tuple",
      protocol_id: `tndm:signet:${"ab".repeat(32)}`,
      height: "1008",
      block_hash: "cd".repeat(32),
      event_root: "ef".repeat(32),
      object_state_root: "01".repeat(32),
      chained_root: "23".repeat(32),
      founding_created: "37",
      all_objects: "41",
      active_objects: "33",
      parser_commit: "aa".repeat(20),
      indexer_commit: "bb".repeat(20),
      parser_binary_sha256: "cc".repeat(32),
      indexer_binary_sha256: "dd".repeat(32),
    },
    signature: "ee".repeat(64),
  };

  assert.equal(inspectEnvelope(JSON.stringify(wellFormed)).firstFailure, null);

  const withExtra = { ...wellFormed, public_key: "ff".repeat(32) };
  assert.match(
    inspectEnvelope(JSON.stringify(withExtra)).firstFailure?.message ?? "",
    /invalid shape/,
  );

  const numericHeight = { ...wellFormed, tuple: { ...wellFormed.tuple, height: 1008 } };
  assert.match(
    inspectEnvelope(JSON.stringify(numericHeight)).firstFailure?.message ?? "",
    /must be a string/,
  );

  const uppercase = {
    ...wellFormed,
    tuple: { ...wellFormed.tuple, block_hash: "CD".repeat(32) },
  };
  assert.match(
    inspectEnvelope(JSON.stringify(uppercase)).firstFailure?.message ?? "",
    /block_hash/,
  );

  const shortSignature = { ...wellFormed, signature: "ee".repeat(32) };
  assert.match(
    inspectEnvelope(JSON.stringify(shortSignature)).firstFailure?.message ?? "",
    /128 lowercase hex/,
  );

  assert.match(inspectEnvelope("not json").firstFailure?.message ?? "", /Not valid JSON/);
});

test("the inspector marks exactly the nine compared fields", () => {
  const result = inspectEnvelope(
    JSON.stringify({
      schema: "urn:tandem:agreement-envelope",
      key_id: "k",
      tuple: {
        schema: "urn:tandem:agreement-tuple",
        protocol_id: `tndm:signet:${"ab".repeat(32)}`,
        height: "1",
        block_hash: "cd".repeat(32),
        event_root: "ef".repeat(32),
        object_state_root: "01".repeat(32),
        chained_root: "23".repeat(32),
        founding_created: "0",
        all_objects: "0",
        active_objects: "0",
        parser_commit: "aa".repeat(20),
        indexer_commit: "bb".repeat(20),
        parser_binary_sha256: "cc".repeat(32),
        indexer_binary_sha256: "dd".repeat(32),
      },
      signature: "ee".repeat(64),
    }),
  );
  assert.equal(result.fieldStatus.filter((field) => field.compared).length, 9);
  assert.equal(result.fieldStatus.filter((field) => !field.compared).length, 4);
});

test("the prose checker rejects an em dash", () => {
  const script = join(SITE, "scripts", "check-prose.mjs");
  const probe = join(SITE, "src", "content", "docs", "__prose-probe.md");
  const dash = String.fromCodePoint(0x2014);
  writeFileSync(probe, `---\ntitle: probe\n---\n\nThis sentence has an em dash ${dash} right here.\n`);
  try {
    execFileSync(process.execPath, [script], { stdio: "pipe" });
    assert.fail("the prose checker should have failed");
  } catch (error) {
    assert.match(String((error as { stderr?: Buffer }).stderr ?? ""), /em dash/);
  } finally {
    unlinkSync(probe);
  }
  // And passes once the offending file is gone.
  execFileSync(process.execPath, [script], { stdio: "pipe" });
});
