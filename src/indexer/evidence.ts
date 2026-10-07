import { createHash } from "node:crypto";
import type {
  TransactionEvidence,
  TransactionInputEvidence,
  VerifiedSignatureEvidence,
} from "@bitcoinuniverse/tandem";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { BitcoinInput, BitcoinTransaction } from "../protocol/bitcoin.js";

const SIGHASH_ALL = 1;
const HALF_ORDER = secp256k1.CURVE.n >> 1n;

function sha256(data: Uint8Array): Buffer {
  return createHash("sha256").update(data).digest();
}

function hash256(data: Uint8Array): Buffer {
  return sha256(sha256(data));
}

function hex(value: string): Buffer {
  return Buffer.from(value, "hex");
}

/** Converts a display-order txid or block hash to wire order. */
export function wire32(displayHex: string): Buffer {
  const bytes = hex(displayHex);
  if (bytes.length !== 32) throw new Error("expected a 32-byte hash");
  return bytes.reverse();
}

function u32le(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

function u64le(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function varBytes(data: Uint8Array): Buffer {
  const length = data.length;
  let prefix: Buffer;
  if (length < 0xfd) prefix = Buffer.from([length]);
  else if (length <= 0xffff) {
    prefix = Buffer.alloc(3);
    prefix[0] = 0xfd;
    prefix.writeUInt16LE(length, 1);
  } else {
    prefix = Buffer.alloc(5);
    prefix[0] = 0xfe;
    prefix.writeUInt32LE(length, 1);
  }
  return Buffer.concat([prefix, data]);
}

/** Wire outpoint of an input: `txid_wire32 || vout_u32le`, or the coinbase null outpoint. */
export function inputOutpoint(input: BitcoinInput): Buffer {
  if (input.txid === undefined || input.vout === undefined) {
    return Buffer.concat([Buffer.alloc(32), u32le(0xffff_ffff)]);
  }
  return Buffer.concat([wire32(input.txid), u32le(input.vout)]);
}

/** BIP66 strict DER check over a signature that still carries its trailing sighash byte. */
export function isStrictDerWithHashType(sig: Uint8Array): boolean {
  if (sig.length < 9 || sig.length > 73) return false;
  if (sig[0] !== 0x30) return false;
  if (sig[1] !== sig.length - 3) return false;
  const lenR = sig[3] ?? 0;
  if (5 + lenR >= sig.length) return false;
  const lenS = sig[5 + lenR] ?? 0;
  if (lenR + lenS + 7 !== sig.length) return false;
  if (sig[2] !== 0x02 || lenR === 0 || ((sig[4] ?? 0) & 0x80) !== 0) return false;
  if (lenR > 1 && sig[4] === 0x00 && ((sig[5] ?? 0) & 0x80) === 0) return false;
  if (sig[lenR + 4] !== 0x02 || lenS === 0 || ((sig[lenR + 6] ?? 0) & 0x80) !== 0) return false;
  if (lenS > 1 && sig[lenR + 6] === 0x00 && ((sig[lenR + 7] ?? 0) & 0x80) === 0) return false;
  return true;
}

function derInteger(bytes: Uint8Array): bigint {
  return bytes.length === 0 ? 0n : BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

class SighashContext {
  private readonly hashPrevouts: Buffer;
  private readonly hashSequence: Buffer;
  private readonly hashOutputs: Buffer;

  constructor(private readonly transaction: BitcoinTransaction) {
    this.hashPrevouts = hash256(Buffer.concat(transaction.inputs.map(inputOutpoint)));
    this.hashSequence = hash256(
      Buffer.concat(transaction.inputs.map((input) => u32le(input.sequence))),
    );
    this.hashOutputs = hash256(
      Buffer.concat(
        transaction.outputs.map((output) =>
          Buffer.concat([u64le(output.valueSats), varBytes(hex(output.scriptPubKeyHex))]),
        ),
      ),
    );
  }

  /** BIP143 SegWit v0 digest for SIGHASH_ALL. */
  digest(index: number, scriptCode: Uint8Array, amount: bigint): Buffer {
    const input = this.transaction.inputs[index];
    if (!input) throw new Error("input index out of range");
    return hash256(
      Buffer.concat([
        u32le(this.transaction.version),
        this.hashPrevouts,
        this.hashSequence,
        inputOutpoint(input),
        varBytes(scriptCode),
        u64le(amount),
        u32le(input.sequence),
        this.hashOutputs,
        u32le(this.transaction.locktime),
        u32le(SIGHASH_ALL),
      ]),
    );
  }
}

function checkSignature(
  signature: Uint8Array,
  publicKey: Uint8Array,
  digest: () => Uint8Array,
): VerifiedSignatureEvidence {
  const sighashType = signature.length > 0 ? (signature[signature.length - 1] ?? -1) : -1;
  const strictDer = isStrictDerWithHashType(signature);
  let lowS = false;
  let cryptographicallyVerified = false;
  if (strictDer) {
    const lenR = signature[3] ?? 0;
    const lenS = signature[5 + lenR] ?? 0;
    const r = derInteger(signature.subarray(4, 4 + lenR));
    const s = derInteger(signature.subarray(6 + lenR, 6 + lenR + lenS));
    lowS = s > 0n && s <= HALF_ORDER;
    if (sighashType === SIGHASH_ALL && publicKey.length === 33) {
      try {
        cryptographicallyVerified = secp256k1.verify(
          new secp256k1.Signature(r, s).toCompactRawBytes(),
          digest(),
          publicKey,
          { prehash: false, lowS: false },
        );
      } catch {
        cryptographicallyVerified = false;
      }
    }
  }
  return {
    publicKey: Uint8Array.from(publicKey),
    sighashType,
    cryptographicallyVerified,
    strictDer,
    lowS,
  };
}

function isP2wpkh(script: Buffer): boolean {
  return script.length === 22 && script[0] === 0x00 && script[1] === 0x14;
}

function isP2wsh(script: Buffer): boolean {
  return script.length === 34 && script[0] === 0x00 && script[1] === 0x20;
}

function isCarrierWitnessScript(script: Buffer): boolean {
  return (
    script.length === 71 &&
    script[0] === 0x52 &&
    script[1] === 0x21 &&
    script[35] === 0x21 &&
    script[69] === 0x52 &&
    script[70] === 0xae
  );
}

function inputEvidence(
  transaction: BitcoinTransaction,
  index: number,
  sighash: SighashContext,
): TransactionInputEvidence {
  const input = transaction.inputs[index] as BitcoinInput;
  const prevoutScript = hex(input.prevout?.scriptPubKeyHex ?? "");
  const amount = input.prevout?.valueSats ?? 0n;
  const witness = input.witness.map(hex);
  const base = {
    outpoint: inputOutpoint(input),
    sequence: input.sequence,
    prevoutValue: amount,
    prevoutScriptPubKey: Uint8Array.from(prevoutScript),
    prevoutHeight:
      input.prevout?.blockHeight === undefined ? null : BigInt(input.prevout.blockHeight),
    scriptSigEmpty: input.scriptSigHex === "",
  };
  if (isP2wpkh(prevoutScript) && witness.length === 2) {
    const [signature, publicKey] = witness as [Buffer, Buffer];
    // BIP143 scriptCode for P2WPKH is the P2PKH script of the witness program.
    const scriptCode = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      prevoutScript.subarray(2),
      Buffer.from([0x88, 0xac]),
    ]);
    return {
      ...base,
      witnessShapeValid: true,
      witnessScript: null,
      revealedPublicKey: Uint8Array.from(publicKey),
      signatures: [
        checkSignature(signature, publicKey, () => sighash.digest(index, scriptCode, amount)),
      ],
    };
  }
  if (isP2wsh(prevoutScript) && witness.length === 4 && witness[0]?.length === 0) {
    const witnessScript = witness[3] as Buffer;
    const signatures: VerifiedSignatureEvidence[] = [];
    if (isCarrierWitnessScript(witnessScript)) {
      const key0 = witnessScript.subarray(2, 35);
      const key1 = witnessScript.subarray(36, 69);
      let cached: Buffer | undefined;
      const digest = () => {
        cached ??= sighash.digest(index, witnessScript, amount);
        return cached;
      };
      signatures.push(checkSignature(witness[1] as Buffer, key0, digest));
      signatures.push(checkSignature(witness[2] as Buffer, key1, digest));
    }
    return {
      ...base,
      witnessShapeValid: true,
      witnessScript: Uint8Array.from(witnessScript),
      revealedPublicKey: null,
      signatures,
    };
  }
  return {
    ...base,
    witnessShapeValid: false,
    witnessScript:
      isP2wsh(prevoutScript) && witness.length > 0
        ? Uint8Array.from(witness.at(-1) as Buffer)
        : null,
    revealedPublicKey: null,
    signatures: [],
  };
}

/** BIP143 SIGHASH_ALL digest for one input; exported for transaction builders and tests. */
export function segwitV0Digest(
  transaction: BitcoinTransaction,
  index: number,
  scriptCode: Uint8Array,
  amount: bigint,
): Buffer {
  return new SighashContext(transaction).digest(index, scriptCode, amount);
}

/**
 * Builds the reference validator's evidence for one confirmed transaction. The block that contains
 * it passed Bitcoin consensus, so BIP68 relative locks of version 2 transactions are satisfied.
 */
export function buildTransactionEvidence(
  transaction: BitcoinTransaction,
  height: number,
): TransactionEvidence {
  const sighash = new SighashContext(transaction);
  return {
    txidWire: Uint8Array.from(wire32(transaction.txid)),
    version: transaction.version,
    lockTime: transaction.locktime,
    height: BigInt(height),
    inputs: transaction.inputs.map((_, index) => inputEvidence(transaction, index, sighash)),
    outputs: transaction.outputs.map((output) => ({
      value: output.valueSats,
      scriptPubKey: Uint8Array.from(hex(output.scriptPubKeyHex)),
    })),
    relativeLocktimeMature: transaction.version >= 2,
  };
}
