/**
 * Protocol values used by the interactive explanations on this site.
 *
 * Every constant here is copied from the canonical package that the indexer
 * depends on (`@bitcoinuniverse/tandem`, `dist/constants.js`) and from the
 * normative specification shipped inside it. The address encoder is a port of
 * `src/api/carrier-address.ts` from the indexer, so an address shown in a
 * teaching model is built by the same rules the indexer uses to decode one.
 *
 * Nothing in this file talks to Bitcoin, signs anything, or broadcasts
 * anything.
 */

export const MAGIC_ASCII = "TNDM";
export const MARKER_FORMAT = 0x01;

export const NETWORK = {
  mainnet: 0x00,
  signet: 0x01,
  testnet4: 0x02,
  regtest: 0x03,
} as const;

export type NetworkName = keyof typeof NETWORK;

export const OPCODE = {
  INIT: 0x00,
  CREATE: 0x01,
  MARK: 0x02,
  ROTATE: 0x03,
  CLOSE: 0x04,
} as const;

/** Exact payload byte length per operation. A different length is invalid. */
export const PAYLOAD_LENGTH: Record<string, number> = {
  INIT: 59,
  CREATE: 40,
  MARK: 78,
  ROTATE: 44,
  CLOSE: 80,
};

/** Exact serialized marker script byte length per operation. */
export const SCRIPT_LENGTH: Record<string, number> = {
  INIT: 61,
  CREATE: 42,
  MARK: 81,
  ROTATE: 46,
  CLOSE: 83,
};

export const CARRIER_VALUE = 20_000;
export const REFUND_DELAY = 52_560;
export const FOUNDING_WINDOW = 4_320;
export const INIT_LEAD = 1_008;
export const CHANGE_FLOOR = 1_000;
export const TX_VERSION = 2;
export const TX_LOCKTIME = 0;
export const REPLACEABLE_SEQUENCE = 0xfffffffd;
export const MAX_MARKER_PAYLOAD = 80;
export const MAX_MARKER_SCRIPT = 83;
export const WITNESS_SCRIPT_BYTES = 71;

export const MARK_KIND = [
  { value: 0x00, name: "note", blurb: "A written entry." },
  { value: 0x01, name: "image", blurb: "A picture." },
  { value: 0x02, name: "audio", blurb: "A recording." },
  { value: 0x03, name: "milestone", blurb: "Something the two of you want marked as significant." },
  { value: 0x04, name: "link", blurb: "A pointer to something held elsewhere." },
  { value: 0x05, name: "opaque data", blurb: "Bytes the protocol deliberately does not interpret." },
] as const;

export const CLOSE_REASON = [
  { value: 0x00, name: "mutual completion" },
  { value: 0x01, name: "relationship ended" },
  { value: 0x02, name: "migrate outside Tandem" },
  { value: 0x03, name: "other" },
] as const;

export const OBJECT_STATUS = ["ACTIVE", "CLOSED", "REFUNDED", "EXITED_NONCANONICAL"] as const;

export const EVENT_TYPE = [
  "INIT",
  "CREATE",
  "MARK",
  "ROTATE",
  "CLOSE",
  "REFUND",
  "EXITED_NONCANONICAL",
  "INVALID",
] as const;

export const VALIDITY_CLASS = [
  "INVALID_NO_STATE",
  "VALID_OPERATION",
  "TERMINAL_NONCANONICAL",
] as const;

export interface ReasonEntry {
  code: number;
  name: string;
  meaning: string;
}

/** The complete, permanent reason registry. Codes and names never change. */
export const REASONS: readonly ReasonEntry[] = [
  { code: 0x0000, name: "VALID", meaning: "A recognised INIT, CREATE, MARK, ROTATE, CLOSE, or REFUND." },
  { code: 0x0001, name: "MULTIPLE_MARKERS", meaning: "More than one Tandem marker candidate remained." },
  {
    code: 0x0002,
    name: "BAD_MARKER_ENCODING_OR_LENGTH",
    meaning:
      "Non-minimal push, malformed script, incomplete push, trailing script data, oversized payload, or the wrong exact payload length.",
  },
  { code: 0x0003, name: "UNKNOWN_MARKER_FORMAT", meaning: "The marker format byte is not 0x01." },
  { code: 0x0004, name: "WRONG_NETWORK", meaning: "The marker network differs from the bound chain." },
  { code: 0x0005, name: "UNKNOWN_OPCODE", meaning: "The opcode is not one Tandem defines." },
  {
    code: 0x0006,
    name: "WRONG_NAMESPACE",
    meaning: "A non-INIT namespace commitment differs from the configured INIT namespace.",
  },
  {
    code: 0x0007,
    name: "UNSUPPORTED_OR_RESERVED_FIELD",
    meaning:
      "A fixed field, constant, supported kind or reason, flag, reserved byte, configured INIT opcode, or INIT spec hash differs.",
  },
  {
    code: 0x0010,
    name: "BAD_TX_VERSION_OR_LOCKTIME",
    meaning: "Transaction version or locktime differs from the exact template.",
  },
  {
    code: 0x0011,
    name: "BAD_INPUT_COUNT_OR_ORDER",
    meaning: "Input count, position, role, or required sequence differs.",
  },
  {
    code: 0x0012,
    name: "BAD_OUTPUT_COUNT_OR_ORDER",
    meaning: "Output count, position, role, marker position, or the only-OP_RETURN requirement differs.",
  },
  {
    code: 0x0013,
    name: "UNCONFIRMED_OR_SAME_BLOCK_PREVOUT",
    meaning: "A required prior output was not confirmed in an earlier block.",
  },
  {
    code: 0x0014,
    name: "BAD_INPUT_SCRIPT",
    meaning: "A prevout, scriptSig, witness stack, or revealed witness script has the wrong form.",
  },
  {
    code: 0x0015,
    name: "BAD_KEY_ORDER_OR_BINDING",
    meaning:
      "A key is invalid, duplicate, unsorted, unchanged when rotation is required, or not bound to its required role.",
  },
  {
    code: 0x0016,
    name: "BAD_SIGNATURE_OR_SIGHASH",
    meaning: "A required signature is invalid, wrongly ordered, non-DER, high-S, or not SIGHASH_ALL.",
  },
  {
    code: 0x0017,
    name: "BAD_OUTPUT_SCRIPT_OR_VALUE",
    meaning:
      "Marker value, fixed carrier value, CREATE carrier script, or a required destination script or key differs.",
  },
  {
    code: 0x0018,
    name: "NONPOSITIVE_OR_INVALID_FEE",
    meaning: "The fee is zero, negative, overflowed, underflowed, or cannot be computed exactly.",
  },
  {
    code: 0x0019,
    name: "BAD_FEE_SPLIT_OR_CHANGE",
    meaning:
      "A debit split, equal payout, sponsor change equation, or 1,000 satoshi change floor differs once the fee is known positive.",
  },
  {
    code: 0x001a,
    name: "PREDECESSOR_NOT_ACTIVE",
    meaning: "The operation does not reference the active canonical predecessor it requires.",
  },
  {
    code: 0x001b,
    name: "BAD_STATE_SEQUENCE",
    meaning: "The state sequence is not predecessor plus one, or cannot be incremented.",
  },
  {
    code: 0x001c,
    name: "BAD_SUCCESSOR",
    meaning:
      "MARK did not preserve the carrier script, or ROTATE did not derive the proposed successor carrier script.",
  },
  { code: 0x001d, name: "BAD_COMMITMENT", meaning: "The MARK chapter commitment is all zero." },
  {
    code: 0x001e,
    name: "BAD_HEIGHT_OR_PHASE",
    meaning: "An INIT lead or window relation fails, arithmetic overflows, or a CREATE confirms before the open height.",
  },
  {
    code: 0x001f,
    name: "BAD_REFUND_SHAPE_OR_MATURITY",
    meaning: "A markerless one-carrier, one-input, two-output candidate failed any exact REFUND rule.",
  },
  {
    code: 0x0020,
    name: "MULTIPLE_CARRIERS",
    meaning: "The transaction spends more than one active Tandem carrier.",
  },
  {
    code: 0x0030,
    name: "UNMARKED_CARRIER_SPEND",
    meaning: "An active carrier was spent with no Tandem marker and the transaction was not dispatched as REFUND.",
  },
];

export function reasonName(code: number): string {
  return REASONS.find((entry) => entry.code === code)?.name ?? "UNKNOWN";
}

export function hex16(code: number): string {
  return `0x${code.toString(16).padStart(4, "0")}`;
}

/* ------------------------------------------------------------------ bech32 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export function networkHrp(network: NetworkName): string {
  if (network === "mainnet") return "bc";
  if (network === "regtest") return "bcrt";
  return "tb";
}

function polymod(values: readonly number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    for (let index = 0; index < GENERATORS.length; index += 1) {
      if (((top >>> index) & 1) !== 0) checksum = (checksum ^ (GENERATORS[index] ?? 0)) >>> 0;
    }
  }
  return checksum;
}

function hrpExpand(hrp: string): number[] {
  return [
    ...[...hrp].map((character) => character.charCodeAt(0) >>> 5),
    0,
    ...[...hrp].map((character) => character.charCodeAt(0) & 31),
  ];
}

function convertBits(values: readonly number[], fromBits: number, toBits: number): number[] {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  const outputMask = (1 << toBits) - 1;
  const maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of values) {
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >>> bits) & outputMask);
    }
  }
  if (bits > 0) result.push((accumulator << (toBits - bits)) & outputMask);
  return result;
}

/** Native SegWit v0 P2WSH address for a 32-byte witness program. */
export function encodeCarrierAddress(witnessProgramHex: string, network: NetworkName): string {
  const bytes: number[] = [];
  for (let index = 0; index < witnessProgramHex.length; index += 2) {
    bytes.push(Number.parseInt(witnessProgramHex.slice(index, index + 2), 16));
  }
  const hrp = networkHrp(network);
  const data = [0, ...convertBits(bytes, 8, 5)];
  const residue = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, index) => (residue >>> (5 * (5 - index))) & 31);
  return `${hrp}1${[...data, ...checksum].map((value) => CHARSET[value]).join("")}`;
}

/* ------------------------------------------------------ namespace binding */

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0) & 0xff);
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

/**
 * The real namespace commitment, computed the way the canonical package does.
 *
 *   SHA256("TANDEM/NAMESPACE\0" || network_u8 || init_txid_wire32 || spec_hash32)
 *
 * The INIT txid is supplied in the usual display order and reversed exactly
 * once to wire order before hashing. The spec hash is a raw digest and is never
 * reversed. Ported from `dist/hash.js` in `@bitcoinuniverse/tandem`.
 */
export async function namespaceCommitment(
  network: NetworkName,
  initTxidDisplayHex: string,
  specHashHex: string,
): Promise<string> {
  const tag = asciiBytes("TANDEM/NAMESPACE\u0000");
  const wire = hexBytes(initTxidDisplayHex).reverse();
  const spec = hexBytes(specHashHex);
  const preimage = new Uint8Array(tag.length + 1 + wire.length + spec.length);
  preimage.set(tag, 0);
  preimage[tag.length] = NETWORK[network];
  preimage.set(wire, tag.length + 1);
  preimage.set(spec, tag.length + 1 + wire.length);
  const digest = await crypto.subtle.digest("SHA-256", preimage);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------- deterministic stand-ins */

/**
 * Stable stand-in bytes for teaching models.
 *
 * These are not hashes of anything and are not derived from a key. They exist
 * so a walkthrough shows values of the right shape and stays reproducible when
 * you reload the page.
 */
export function standInHex(seed: string, bytes = 32): string {
  let state = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  let out = "";
  for (let index = 0; index < bytes; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out += (state & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

/** A stand-in compressed secp256k1 public key: 33 bytes starting 0x02 or 0x03. */
export function standInKey(seed: string): string {
  const body = standInHex(seed, 32);
  const prefix = Number.parseInt(body.slice(0, 2), 16) % 2 === 0 ? "02" : "03";
  return prefix + body;
}

export function shorten(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/* ------------------------------------------------------- the state machine */

export type ObjectStatus = "active" | "closed" | "refunded" | "exited_noncanonical";

export type Operation = "CREATE" | "MARK" | "ROTATE" | "CLOSE" | "REFUND" | "BREAK";

export interface HistoryEntry {
  operation: Operation | "EXITED_NONCANONICAL";
  sequence: number;
  txid: string;
  height: number;
  detail: string;
}

export interface TandemObject {
  status: ObjectStatus;
  sequence: number;
  chapterCount: number;
  key0: string;
  key1: string;
  currentOutpoint: string | null;
  terminalTxid: string | null;
  createTxid: string;
  createHeight: number;
  founding: boolean;
  carrierProgram: string;
  history: HistoryEntry[];
}

export interface Deployment {
  network: NetworkName;
  openHeight: number;
  closeHeight: number;
}

/** Sorted pair, because the protocol requires key0 < key1 bytewise. */
function sortPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function carrierProgram(key0: string, key1: string): string {
  // The real witness program is SHA256 of the 71-byte witness script. A teaching
  // model cannot compute that without a hash implementation, so this derives a
  // stable stand-in from the same two keys.
  return standInHex(`carrier:${key0}:${key1}`);
}

export function createObject(seed: string, deployment: Deployment, height: number): TandemObject {
  const [key0, key1] = sortPair(standInKey(`${seed}:k0`), standInKey(`${seed}:k1`));
  const txid = standInHex(`${seed}:create`);
  return {
    status: "active",
    sequence: 0,
    chapterCount: 0,
    key0,
    key1,
    currentOutpoint: `${txid}:1`,
    terminalTxid: null,
    createTxid: txid,
    createHeight: height,
    founding: height >= deployment.openHeight && height < deployment.closeHeight,
    carrierProgram: carrierProgram(key0, key1),
    history: [
      {
        operation: "CREATE",
        sequence: 0,
        txid,
        height,
        detail: "Both parties signed. The object exists at sequence 0 with no chapters yet.",
      },
    ],
  };
}

export interface ApplyResult {
  object: TandemObject;
  note: string;
}

/**
 * Mirrors `applyStateTransition` in `src/protocol/state-engine.ts`.
 *
 * MARK and ROTATE and CLOSE each require exactly predecessor sequence plus one.
 * REFUND and a non-canonical exit keep the sequence where it is. Only MARK
 * increments the chapter count.
 */
export function applyOperation(
  object: TandemObject,
  operation: Operation,
  options: { seed: string; height: number; kind?: number },
): ApplyResult {
  if (object.status !== "active") {
    return { object, note: "This object is terminal. No Tandem operation can follow." };
  }

  const txid = standInHex(`${options.seed}:${operation}:${object.sequence}`);
  const next: TandemObject = { ...object, history: [...object.history] };

  if (operation === "MARK") {
    next.sequence = object.sequence + 1;
    next.chapterCount = object.chapterCount + 1;
    next.currentOutpoint = `${txid}:1`;
    next.history.push({
      operation: "MARK",
      sequence: next.sequence,
      txid,
      height: options.height,
      detail: `Chapter ${next.chapterCount} recorded as kind ${options.kind ?? 0}. The key pair is unchanged and the carrier script is preserved byte for byte.`,
    });
    return { object: next, note: "A chapter is the only thing that increments the chapter count." };
  }

  if (operation === "ROTATE") {
    const [key0, key1] = sortPair(
      standInKey(`${options.seed}:k0:${object.sequence + 1}`),
      standInKey(`${options.seed}:k1:${object.sequence + 1}`),
    );
    next.sequence = object.sequence + 1;
    next.key0 = key0;
    next.key1 = key1;
    next.carrierProgram = carrierProgram(key0, key1);
    next.currentOutpoint = `${txid}:1`;
    next.history.push({
      operation: "ROTATE",
      sequence: next.sequence,
      txid,
      height: options.height,
      detail:
        "Both new keys were revealed by their own inputs. The chapter count is untouched, so the history survives the key change.",
    });
    return {
      object: next,
      note: "Rotation changes who can sign next without disturbing anything already written.",
    };
  }

  if (operation === "CLOSE") {
    next.sequence = object.sequence + 1;
    next.status = "closed";
    next.currentOutpoint = null;
    next.terminalTxid = txid;
    next.history.push({
      operation: "CLOSE",
      sequence: next.sequence,
      txid,
      height: options.height,
      detail:
        "One input, both signatures, two equal payouts. The object ends with its history intact and readable forever.",
    });
    return { object: next, note: "A cooperative ending still needs both signatures." };
  }

  if (operation === "REFUND") {
    next.status = "refunded";
    next.currentOutpoint = null;
    next.terminalTxid = txid;
    next.history.push({
      operation: "REFUND",
      sequence: object.sequence,
      txid,
      height: options.height,
      detail: `Both parties signed this refund in advance, because it spends the same 2 of 2 carrier. Its input sequence is ${REFUND_DELAY}, so consensus refused to confirm it until the carrier was at least ${REFUND_DELAY.toLocaleString("en-US")} blocks old. The sequence number does not advance.`,
    });
    return {
      object: next,
      note: "Once the delay has run, either party can broadcast it without the other having to act.",
    };
  }

  next.status = "exited_noncanonical";
  next.currentOutpoint = null;
  next.terminalTxid = txid;
  next.history.push({
    operation: "EXITED_NONCANONICAL",
    sequence: object.sequence,
    txid,
    height: options.height,
    detail:
      "The carrier was spent by a transaction that is not a valid Tandem operation. The output is gone, so the object has to terminate.",
  });
  return {
    object: next,
    note: "The indexer never pretends a spent carrier is still there.",
  };
}
