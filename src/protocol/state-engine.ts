export type TandemObjectStatus = "active" | "closed" | "refunded" | "exited_noncanonical";

export interface IndexedObjectState {
  objectKey: string;
  status: TandemObjectStatus;
  sequence: number;
  currentOutpoint: string | null;
  key0: string;
  key1: string;
  chapterCount: number;
  terminalTxid: string | null;
}

export type StateTransition =
  | {
      operation: "CREATE";
      objectKey: string;
      successorOutpoint: string;
      key0: string;
      key1: string;
    }
  | {
      operation: "MARK" | "ROTATE";
      objectKey: string;
      sequence: number;
      predecessorOutpoint: string;
      successorOutpoint: string;
      key0: string;
      key1: string;
    }
  | {
      operation: "CLOSE";
      objectKey: string;
      sequence: number;
      predecessorOutpoint: string;
      terminalTxid: string;
    }
  | {
      operation: "REFUND" | "EXITED_NONCANONICAL";
      objectKey: string;
      predecessorOutpoint: string;
      terminalTxid: string;
    };

export class StateInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateInvariantError";
  }
}

function requireActive(
  states: ReadonlyMap<string, IndexedObjectState>,
  objectKey: string,
  predecessorOutpoint: string,
): IndexedObjectState {
  const current = states.get(objectKey);
  if (!current || current.status !== "active") {
    throw new StateInvariantError("predecessor object is not active");
  }
  if (current.currentOutpoint !== predecessorOutpoint) {
    throw new StateInvariantError("predecessor outpoint does not match current state");
  }
  return current;
}

export function applyStateTransition(
  states: ReadonlyMap<string, IndexedObjectState>,
  transition: StateTransition,
): Map<string, IndexedObjectState> {
  const next = new Map(states);
  if (transition.operation === "CREATE") {
    if (states.has(transition.objectKey)) throw new StateInvariantError("object already exists");
    next.set(transition.objectKey, {
      objectKey: transition.objectKey,
      status: "active",
      sequence: 0,
      currentOutpoint: transition.successorOutpoint,
      key0: transition.key0,
      key1: transition.key1,
      chapterCount: 0,
      terminalTxid: null,
    });
    return next;
  }
  const current = requireActive(states, transition.objectKey, transition.predecessorOutpoint);
  if (transition.operation === "MARK" || transition.operation === "ROTATE") {
    if (transition.sequence !== current.sequence + 1) {
      throw new StateInvariantError("state sequence must increase by exactly one");
    }
    next.set(transition.objectKey, {
      ...current,
      sequence: transition.sequence,
      currentOutpoint: transition.successorOutpoint,
      key0: transition.key0,
      key1: transition.key1,
      chapterCount: current.chapterCount + (transition.operation === "MARK" ? 1 : 0),
    });
    return next;
  }
  if (transition.operation === "CLOSE" && transition.sequence !== current.sequence + 1) {
    throw new StateInvariantError("close sequence must increase by exactly one");
  }
  const terminal = transition as Extract<
    StateTransition,
    { operation: "CLOSE" | "REFUND" | "EXITED_NONCANONICAL" }
  >;
  next.set(transition.objectKey, {
    ...current,
    status:
      transition.operation === "CLOSE"
        ? "closed"
        : transition.operation === "REFUND"
          ? "refunded"
          : "exited_noncanonical",
    sequence: transition.operation === "CLOSE" ? transition.sequence : current.sequence,
    currentOutpoint: null,
    terminalTxid: terminal.terminalTxid,
  });
  return next;
}
