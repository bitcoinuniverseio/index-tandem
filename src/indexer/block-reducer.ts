import {
  type ActiveCarrierEvidence,
  type CanonicalEvent,
  chainedBlockRoot,
  EVENT_TYPE,
  type EventType,
  eventRoot,
  inspectMarkerScript,
  type Marker,
  type NetworkCode,
  OBJECT_STATUS,
  type ObjectSnapshot,
  objectKeyFromWire,
  objectStateRoot,
  PAYLOAD_LENGTH,
  parseMarkerScript,
  type ReasonCode,
  type TransactionValidationEvent,
  VALIDITY_CLASS,
  type ValidityClass,
  validateTandemTransaction,
} from "@bitcoinuniverse/tandem";
import type { BitcoinBlock, BitcoinTransaction } from "../protocol/bitcoin.js";
import { orderedBlockTransactions } from "../protocol/block-ordering.js";
import { buildTransactionEvidence, inputOutpoint, wire32 } from "./evidence.js";

export type ObjectStatusName = "active" | "closed" | "refunded" | "exited_noncanonical";

/** Canonical object state as stored in `tandem_objects`, plus the current carrier height. */
export interface ObjectRecord {
  objectKey: string;
  createTxid: string;
  createHeight: number;
  founding: boolean;
  status: ObjectStatusName;
  stateSequence: number;
  currentOutpoint: string | null;
  /** Confirmation height of the current carrier; null once terminal. */
  currentHeight: number | null;
  key0: string;
  key1: string;
  terminalTxid: string | null;
  chapterCount: number;
}

export interface Binding {
  networkCode: NetworkCode;
  initTxid: string;
  specHash: string;
  namespace: string;
}

/** Result of validating the configured INIT in its confirmation block. */
export interface InitActivation {
  txid: string;
  height: number;
  blockHash: string;
  openHeight: number | null;
  closeHeight: number | null;
  valid: boolean;
  reason: number;
}

export interface EventRecord {
  txid: string;
  wtxid: string;
  txIndex: number;
  eventIndex: number;
  subIndex: number;
  eventType: number;
  validityClass: number;
  reason: number;
  namespace: string;
  objectKey: string | null;
  stateSequence: number;
  predecessorOutpoint: string | null;
  successorOutpoint: string | null;
  key0: string | null;
  key1: string | null;
  commitment: string | null;
  markerPayload: string | null;
}

export interface StateRow {
  outpoint: string;
  objectKey: string;
  sequence: number;
  key0: string;
  key1: string;
}

export interface ChapterRow {
  objectKey: string;
  sequence: number;
  txid: string;
  kind: number;
  commitment: string;
}

export interface ReducedBlock {
  height: number;
  hash: string;
  previousHash: string | null;
  time: number;
  activation: InitActivation;
  /** Set only for the block that confirms the configured INIT. */
  initConfirmed: boolean;
  events: EventRecord[];
  transactions: Array<{
    txid: string;
    wtxid: string;
    txIndex: number;
    version: number;
    locktime: number;
  }>;
  /** Post-block object map. */
  objects: Map<string, ObjectRecord>;
  /** Pre-block snapshot of every object this block touched; null means created here. */
  undo: Map<string, ObjectRecord | null>;
  newStates: StateRow[];
  spentOutpoints: Array<{ outpoint: string; txid: string }>;
  chapters: ChapterRow[];
  eventRoot: string;
  objectStateRoot: string;
  chainedRoot: string;
  foundingCreated: bigint;
  allObjects: bigint;
  activeObjects: bigint;
}

const NO_SEQUENCE = 0xffff_ffff;
const NO_INDEX = 0xffff_ffff;
const ZERO32 = new Uint8Array(32);
const ZERO33 = new Uint8Array(33);
const ZERO36 = new Uint8Array(36);

const STATUS_CODE: Record<ObjectStatusName, (typeof OBJECT_STATUS)[keyof typeof OBJECT_STATUS]> = {
  active: OBJECT_STATUS.ACTIVE,
  closed: OBJECT_STATUS.CLOSED,
  refunded: OBJECT_STATUS.REFUNDED,
  exited_noncanonical: OBJECT_STATUS.EXITED_NONCANONICAL,
};

function bytes(hexValue: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hexValue, "hex"));
}

function toHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

/** Display outpoint `txid:vout` to `outpoint36`. */
export function outpointWire(outpoint: string): Uint8Array {
  const [txid, vout] = outpoint.split(":");
  const out = Buffer.alloc(36);
  wire32(txid as string).copy(out, 0);
  out.writeUInt32LE(Number(vout), 32);
  return Uint8Array.from(out);
}

function inputDisplayOutpoint(input: BitcoinTransaction["inputs"][number]): string | null {
  return input.txid === undefined || input.vout === undefined
    ? null
    : `${input.txid}:${input.vout}`;
}

interface Candidate {
  vout: number;
  payload: Uint8Array;
  complete: boolean;
}

/** Section 6.1 candidates with foreign INIT candidates removed (section 11.2 step 2). */
function remainingCandidates(transaction: BitcoinTransaction, initTxid: string): Candidate[] {
  const result: Candidate[] = [];
  for (const output of transaction.outputs) {
    if (!output.scriptPubKeyHex.startsWith("6a")) continue;
    const script = bytes(output.scriptPubKeyHex);
    const inspection = inspectMarkerScript(script);
    if (!inspection.candidate) continue;
    if (inspection.payload[6] === 0x00 && transaction.txid !== initTxid) continue;
    result.push({
      vout: output.n,
      payload: inspection.payload,
      complete: declaredLength(script) === inspection.payload.length,
    });
  }
  return result;
}

function declaredLength(script: Uint8Array): number {
  const push = script[1] ?? 0;
  if (push >= 1 && push <= 75) return push;
  if (push === 0x4c) return script[2] ?? -1;
  if (push === 0x4d) return (script[2] ?? 0) | ((script[3] ?? 0) << 8);
  if (push === 0x4e) return Buffer.from(script.subarray(2, 6)).readUInt32LE(0);
  return -1;
}

/** Section 12: attempted type only for format 0x01 with a defined opcode. */
function attemptedType(candidate: Candidate): EventType {
  const opcode = candidate.payload[6];
  if (candidate.payload[4] !== 0x01 || opcode === undefined || opcode > 4) {
    return EVENT_TYPE.INVALID;
  }
  return opcode as EventType;
}

/** Sections 13.4 and 13.5: population-only namespace of a complete defined non-INIT payload. */
function populationNamespace(candidate: Candidate): Uint8Array | null {
  const opcode = candidate.payload[6];
  if (
    !candidate.complete ||
    candidate.payload[4] !== 0x01 ||
    opcode === undefined ||
    opcode < 1 ||
    opcode > 4 ||
    candidate.payload.length !== PAYLOAD_LENGTH[opcode as 1 | 2 | 3 | 4]
  ) {
    return null;
  }
  return candidate.payload.slice(8, 40);
}

function snapshot(record: ObjectRecord): ObjectSnapshot {
  return {
    objectKey: bytes(record.objectKey),
    founding: record.founding,
    status: STATUS_CODE[record.status],
    createHeight: BigInt(record.createHeight),
    stateSequence: record.stateSequence,
    currentOutpoint: record.currentOutpoint ? outpointWire(record.currentOutpoint) : ZERO36,
    key0: bytes(record.key0),
    key1: bytes(record.key1),
    terminalTxidWire: record.terminalTxid ? Uint8Array.from(wire32(record.terminalTxid)) : ZERO32,
    chapterCount: record.chapterCount,
  };
}

function carrierEvidence(record: ObjectRecord): ActiveCarrierEvidence {
  return {
    objectKey: bytes(record.objectKey),
    outpoint: outpointWire(record.currentOutpoint as string),
    stateSequence: record.stateSequence,
    key0: bytes(record.key0),
    key1: bytes(record.key1),
    confirmedHeight: BigInt(record.currentHeight ?? 0),
  };
}

function isRelevant(
  transaction: BitcoinTransaction,
  activeByOutpoint: ReadonlyMap<string, string>,
  initTxid: string,
): boolean {
  if (transaction.txid === initTxid) return true;
  if (
    transaction.outputs.some(
      (output) =>
        output.scriptPubKeyHex.startsWith("6a") &&
        inspectMarkerScript(bytes(output.scriptPubKeyHex)).candidate,
    )
  ) {
    return true;
  }
  return transaction.inputs.some((input) => {
    const outpoint = inputDisplayOutpoint(input);
    return outpoint !== null && activeByOutpoint.has(outpoint);
  });
}

/** Parses the configured INIT marker to read `H_open` and `H_close` for its own validation. */
function initHeights(
  transaction: BitcoinTransaction,
  networkCode: NetworkCode,
): { openHeight: number; closeHeight: number } | null {
  const markers = remainingCandidates(transaction, transaction.txid);
  if (markers.length !== 1) return null;
  const output = transaction.outputs.find((item) => item.n === markers[0]?.vout);
  if (!output) return null;
  const parsed = parseMarkerScript(bytes(output.scriptPubKeyHex), networkCode);
  if (!parsed.ok || parsed.marker.operation !== "INIT") return null;
  return { openHeight: parsed.marker.openHeight, closeHeight: parsed.marker.closeHeight };
}

interface WorkingState {
  objects: Map<string, ObjectRecord>;
  activeByOutpoint: Map<string, string>;
  undo: Map<string, ObjectRecord | null>;
  newStates: StateRow[];
  spentOutpoints: Array<{ outpoint: string; txid: string }>;
  chapters: ChapterRow[];
}

function touch(state: WorkingState, objectKey: string): void {
  if (!state.undo.has(objectKey)) {
    const prior = state.objects.get(objectKey);
    state.undo.set(objectKey, prior ? { ...prior } : null);
  }
}

function terminate(
  state: WorkingState,
  record: ObjectRecord,
  status: ObjectStatusName,
  txid: string,
  stateSequence = record.stateSequence,
): void {
  touch(state, record.objectKey);
  if (record.currentOutpoint) {
    state.activeByOutpoint.delete(record.currentOutpoint);
    state.spentOutpoints.push({ outpoint: record.currentOutpoint, txid });
  }
  state.objects.set(record.objectKey, {
    ...record,
    status,
    stateSequence,
    currentOutpoint: null,
    currentHeight: null,
    terminalTxid: txid,
  });
}

function advance(
  state: WorkingState,
  record: ObjectRecord,
  txid: string,
  height: number,
  sequence: number,
  key0: string,
  key1: string,
  chapter: { kind: number; commitment: string } | null,
): void {
  touch(state, record.objectKey);
  const successor = `${txid}:1`;
  if (record.currentOutpoint) {
    state.activeByOutpoint.delete(record.currentOutpoint);
    state.spentOutpoints.push({ outpoint: record.currentOutpoint, txid });
  }
  state.activeByOutpoint.set(successor, record.objectKey);
  state.objects.set(record.objectKey, {
    ...record,
    stateSequence: sequence,
    currentOutpoint: successor,
    currentHeight: height,
    key0,
    key1,
    chapterCount: record.chapterCount + (chapter ? 1 : 0),
  });
  state.newStates.push({ outpoint: successor, objectKey: record.objectKey, sequence, key0, key1 });
  if (chapter) {
    state.chapters.push({ objectKey: record.objectKey, sequence, txid, ...chapter });
  }
}

interface ClassifiedTransaction {
  events: EventRecord[];
}

function classifyTransaction(
  binding: Binding,
  activation: { height: number; openHeight: number; closeHeight: number },
  state: WorkingState,
  transaction: BitcoinTransaction,
  txIndex: number,
  height: number,
): ClassifiedTransaction {
  const namespace = bytes(binding.namespace);
  const consumed = transaction.inputs
    .map((input) => inputDisplayOutpoint(input))
    .filter((outpoint): outpoint is string => outpoint !== null)
    .map((outpoint) => state.activeByOutpoint.get(outpoint))
    .filter((key): key is string => key !== undefined)
    .map((key) => state.objects.get(key) as ObjectRecord);
  const evidence = buildTransactionEvidence(transaction, height);
  const result = validateTandemTransaction(evidence, {
    network: binding.networkCode,
    namespace,
    init: {
      txidWire: Uint8Array.from(wire32(binding.initTxid)),
      specHash: bytes(binding.specHash),
      confirmationHeight: BigInt(activation.height),
      openHeight: activation.openHeight,
      closeHeight: activation.closeHeight,
    },
    activeCarriers: consumed.map(carrierEvidence),
  });
  if (!result.relevant || result.events.length === 0) return { events: [] };
  const candidates = remainingCandidates(transaction, binding.initTxid);
  const configuredInit = transaction.txid === binding.initTxid;
  const eventIndex = candidates[0]?.vout ?? NO_INDEX;
  const markerCandidate = candidates.length === 1 ? candidates[0] : undefined;
  const markerPayload = markerCandidate ? toHex(markerCandidate.payload) : null;
  const events: EventRecord[] = [];
  result.events.forEach((event, subIndex) => {
    const base = {
      txid: transaction.txid,
      wtxid: transaction.wtxid,
      txIndex,
      eventIndex,
      subIndex,
      reason: event.reason as number,
      markerPayload,
    };
    if (event.validityClass === VALIDITY_CLASS.VALID_OPERATION) {
      events.push(
        applyValid(binding, activation, state, transaction, height, event, result.marker, base),
      );
      return;
    }
    if (event.validityClass === VALIDITY_CLASS.TERMINAL_NONCANONICAL) {
      const key = toHex(event.objectKey as Uint8Array);
      const record = state.objects.get(key) as ObjectRecord;
      let eventNamespace: Uint8Array = ZERO32;
      if (candidates.length === 0) eventNamespace = namespace;
      else if (markerCandidate) eventNamespace = populationNamespace(markerCandidate) ?? ZERO32;
      events.push({
        ...base,
        eventType: EVENT_TYPE.EXITED_NONCANONICAL,
        validityClass: VALIDITY_CLASS.TERMINAL_NONCANONICAL,
        namespace: toHex(eventNamespace),
        objectKey: key,
        stateSequence: record.stateSequence,
        predecessorOutpoint: record.currentOutpoint,
        successorOutpoint: null,
        key0: record.key0,
        key1: record.key1,
        commitment: null,
      });
      terminate(state, record, "exited_noncanonical", transaction.txid);
      return;
    }
    let eventNamespace: Uint8Array = ZERO32;
    if (configuredInit) eventNamespace = namespace;
    else if (markerCandidate) eventNamespace = populationNamespace(markerCandidate) ?? ZERO32;
    events.push({
      ...base,
      eventType: markerCandidate ? attemptedType(markerCandidate) : EVENT_TYPE.INVALID,
      validityClass: VALIDITY_CLASS.INVALID_NO_STATE,
      namespace: toHex(eventNamespace),
      objectKey: null,
      stateSequence: NO_SEQUENCE,
      predecessorOutpoint: null,
      successorOutpoint: null,
      key0: null,
      key1: null,
      commitment: null,
    });
  });
  return { events };
}

function applyValid(
  binding: Binding,
  activation: { openHeight: number; closeHeight: number },
  state: WorkingState,
  transaction: BitcoinTransaction,
  height: number,
  event: TransactionValidationEvent,
  marker: Marker | null,
  base: Omit<
    EventRecord,
    | "eventType"
    | "validityClass"
    | "namespace"
    | "objectKey"
    | "stateSequence"
    | "predecessorOutpoint"
    | "successorOutpoint"
    | "key0"
    | "key1"
    | "commitment"
  >,
): EventRecord {
  const common = {
    ...base,
    validityClass: VALIDITY_CLASS.VALID_OPERATION as ValidityClass,
    namespace: binding.namespace,
  };
  const revealed = (index: number) => {
    const witness = transaction.inputs[index]?.witness;
    return (witness?.[1] ?? "").toLowerCase();
  };
  switch (event.operation) {
    case "INIT":
      return {
        ...common,
        eventType: EVENT_TYPE.INIT,
        objectKey: null,
        stateSequence: NO_SEQUENCE,
        predecessorOutpoint: null,
        successorOutpoint: null,
        key0: null,
        key1: null,
        commitment: marker?.operation === "INIT" ? toHex(marker.specHash) : null,
      };
    case "CREATE": {
      const objectKey = toHex(
        objectKeyFromWire(bytes(binding.namespace), Uint8Array.from(wire32(transaction.txid))),
      );
      const key0 = revealed(0);
      const key1 = revealed(1);
      const successor = `${transaction.txid}:1`;
      touch(state, objectKey);
      state.objects.set(objectKey, {
        objectKey,
        createTxid: transaction.txid,
        createHeight: height,
        founding: height >= activation.openHeight && height < activation.closeHeight,
        status: "active",
        stateSequence: 0,
        currentOutpoint: successor,
        currentHeight: height,
        key0,
        key1,
        terminalTxid: null,
        chapterCount: 0,
      });
      state.activeByOutpoint.set(successor, objectKey);
      state.newStates.push({ outpoint: successor, objectKey, sequence: 0, key0, key1 });
      return {
        ...common,
        eventType: EVENT_TYPE.CREATE,
        objectKey,
        stateSequence: 0,
        predecessorOutpoint: null,
        successorOutpoint: successor,
        key0,
        key1,
        commitment: null,
      };
    }
    case "MARK":
    case "ROTATE":
    case "CLOSE":
    case "REFUND": {
      const objectKey = toHex(event.objectKey as Uint8Array);
      const record = state.objects.get(objectKey) as ObjectRecord;
      const predecessor = record.currentOutpoint;
      if (event.operation === "REFUND") {
        terminate(state, record, "refunded", transaction.txid);
        return {
          ...common,
          eventType: EVENT_TYPE.REFUND,
          objectKey,
          stateSequence: record.stateSequence,
          predecessorOutpoint: predecessor,
          successorOutpoint: null,
          key0: record.key0,
          key1: record.key1,
          commitment: null,
        };
      }
      const sequence = (marker as Extract<Marker, { sequence: number }>).sequence;
      if (marker?.operation === "CLOSE") {
        terminate(state, record, "closed", transaction.txid, sequence);
        return {
          ...common,
          eventType: EVENT_TYPE.CLOSE,
          objectKey,
          stateSequence: sequence,
          predecessorOutpoint: predecessor,
          successorOutpoint: null,
          key0: record.key0,
          key1: record.key1,
          commitment: toHex(marker.commitment),
        };
      }
      if (marker?.operation === "MARK") {
        advance(state, record, transaction.txid, height, sequence, record.key0, record.key1, {
          kind: marker.kind,
          commitment: toHex(marker.commitment),
        });
        return {
          ...common,
          eventType: EVENT_TYPE.MARK,
          objectKey,
          stateSequence: sequence,
          predecessorOutpoint: predecessor,
          successorOutpoint: `${transaction.txid}:1`,
          key0: record.key0,
          key1: record.key1,
          commitment: toHex(marker.commitment),
        };
      }
      const key0 = revealed(1);
      const key1 = revealed(2);
      advance(state, record, transaction.txid, height, sequence, key0, key1, null);
      return {
        ...common,
        eventType: EVENT_TYPE.ROTATE,
        objectKey,
        stateSequence: sequence,
        predecessorOutpoint: predecessor,
        successorOutpoint: `${transaction.txid}:1`,
        key0,
        key1,
        commitment: null,
      };
    }
    default:
      throw new Error(`unexpected valid operation ${event.operation}`);
  }
}

function canonicalEvent(
  record: EventRecord,
  blockHashWire: Uint8Array,
  height: number,
): CanonicalEvent {
  return {
    namespace: bytes(record.namespace),
    blockHashWire,
    height: BigInt(height),
    txIndex: record.txIndex,
    eventIndex: record.eventIndex,
    subIndex: record.subIndex,
    eventType: record.eventType as EventType,
    validityClass: record.validityClass as ValidityClass,
    reason: record.reason as ReasonCode,
    txidWire: Uint8Array.from(wire32(record.txid)),
    wtxidWire: Uint8Array.from(wire32(record.wtxid)),
    objectKey: record.objectKey ? bytes(record.objectKey) : ZERO32,
    stateSequence: record.stateSequence,
    predecessorOutpoint: record.predecessorOutpoint
      ? outpointWire(record.predecessorOutpoint)
      : ZERO36,
    successorOutpoint: record.successorOutpoint ? outpointWire(record.successorOutpoint) : ZERO36,
    key0: record.key0 ? bytes(record.key0) : ZERO33,
    key1: record.key1 ? bytes(record.key1) : ZERO33,
    commitment: record.commitment ? bytes(record.commitment) : ZERO32,
  };
}

/**
 * Connects one canonical block at or after the configured INIT confirmation block. `activation` is
 * null only when this block is expected to confirm the INIT; the caller guarantees that the block
 * contains the configured txid in that case.
 */
export function reduceBlock(input: {
  binding: Binding;
  activation: InitActivation | null;
  previousRoot: Uint8Array;
  objects: ReadonlyMap<string, ObjectRecord>;
  block: BitcoinBlock;
}): ReducedBlock {
  const { binding, block } = input;
  const ordered = orderedBlockTransactions(block);
  let activation = input.activation;
  const state: WorkingState = {
    objects: new Map(input.objects),
    activeByOutpoint: new Map(),
    undo: new Map(),
    newStates: [],
    spentOutpoints: [],
    chapters: [],
  };
  for (const record of state.objects.values()) {
    if (record.status === "active" && record.currentOutpoint) {
      state.activeByOutpoint.set(record.currentOutpoint, record.objectKey);
    }
  }
  const events: EventRecord[] = [];
  const initConfirmed = activation === null;
  if (activation === null) {
    const init = ordered.find(({ transaction }) => transaction.txid === binding.initTxid);
    if (!init) throw new Error("configured INIT is not in the activation block");
    const heights = initHeights(init.transaction, binding.networkCode);
    const classified = classifyTransaction(
      binding,
      {
        height: block.height,
        openHeight: heights?.openHeight ?? 0,
        closeHeight: heights?.closeHeight ?? 0,
      },
      state,
      init.transaction,
      init.txIndex,
      block.height,
    );
    const initEvent = classified.events[0];
    const valid = initEvent?.validityClass === VALIDITY_CLASS.VALID_OPERATION;
    activation = {
      txid: binding.initTxid,
      height: block.height,
      blockHash: block.hash,
      openHeight: heights?.openHeight ?? null,
      closeHeight: heights?.closeHeight ?? null,
      valid,
      reason: initEvent?.reason ?? 2,
    };
    if (!valid) events.push(...classified.events);
  }
  if (activation.valid && activation.openHeight !== null && activation.closeHeight !== null) {
    const heights = {
      height: activation.height,
      openHeight: activation.openHeight,
      closeHeight: activation.closeHeight,
    };
    for (const { txIndex, transaction } of ordered) {
      if (!isRelevant(transaction, state.activeByOutpoint, binding.initTxid)) continue;
      events.push(
        ...classifyTransaction(binding, heights, state, transaction, txIndex, block.height).events,
      );
    }
  }
  const namespace = bytes(binding.namespace);
  const blockHashWire = Uint8Array.from(wire32(block.hash));
  const eventRootBytes = eventRoot(
    namespace,
    events.map((event) => canonicalEvent(event, blockHashWire, block.height)),
  );
  const records = [...state.objects.values()];
  const stateRootBytes = objectStateRoot(namespace, records.map(snapshot));
  const foundingCreated = BigInt(records.filter((record) => record.founding).length);
  const allObjects = BigInt(records.length);
  const activeObjects = BigInt(records.filter((record) => record.status === "active").length);
  const chained = chainedBlockRoot({
    namespace,
    previousRoot: input.previousRoot,
    blockHashWire,
    height: BigInt(block.height),
    eventRoot: eventRootBytes,
    objectStateRoot: stateRootBytes,
    foundingCreated,
    allObjects,
    activeObjects,
  });
  const txids = new Set(events.map((event) => event.txid));
  return {
    height: block.height,
    hash: block.hash,
    previousHash: block.previousBlockHash,
    time: block.time,
    activation,
    initConfirmed,
    events,
    transactions: ordered
      .filter(({ transaction }) => txids.has(transaction.txid))
      .map(({ txIndex, transaction }) => ({
        txid: transaction.txid,
        wtxid: transaction.wtxid,
        txIndex,
        version: transaction.version,
        locktime: transaction.locktime,
      })),
    objects: state.objects,
    undo: state.undo,
    newStates: state.newStates,
    spentOutpoints: state.spentOutpoints,
    chapters: state.chapters,
    eventRoot: toHex(eventRootBytes),
    objectStateRoot: toHex(stateRootBytes),
    chainedRoot: toHex(chained),
    foundingCreated,
    allObjects,
    activeObjects,
  };
}

export { inputOutpoint };
