import { createHash } from "node:crypto";
import {
  carrierScriptPubKey,
  carrierWitnessScript,
  p2wpkhScriptPubKey,
} from "@bitcoinuniverse/tandem";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { segwitV0Digest } from "../../src/indexer/evidence.js";
import type { BitcoinTransaction } from "../../src/protocol/bitcoin.js";

/** Minimal signed SegWit v0 transaction builder for Tandem tests and regtest probes. */

export interface Prevout {
  txid: string;
  vout: number;
  valueSats: bigint;
  scriptPubKeyHex: string;
  height: number;
}

export interface Signer {
  secret: Uint8Array;
  publicKey: Uint8Array;
}

export type InputSpec =
  | { kind: "p2wpkh"; prevout: Prevout; signer: Signer; sequence: number }
  | { kind: "carrier"; prevout: Prevout; signers: [Signer, Signer]; sequence: number };

export interface OutputSpec {
  valueSats: bigint;
  scriptPubKeyHex: string;
}

const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");

export function signerFrom(seed: number | Uint8Array): Signer {
  const secret =
    typeof seed === "number"
      ? Uint8Array.from(createHash("sha256").update(`tandem-test-${seed}`).digest())
      : seed;
  return { secret, publicKey: secp256k1.getPublicKey(secret, true) };
}

/** Returns the two signers ordered so that key0 < key1 bytewise. */
export function sortedPair(a: Signer, b: Signer): [Signer, Signer] {
  return Buffer.compare(Buffer.from(a.publicKey), Buffer.from(b.publicKey)) < 0 ? [a, b] : [b, a];
}

export function p2wpkhHex(signer: Signer): string {
  return hex(p2wpkhScriptPubKey(signer.publicKey));
}

export function carrierHex(pair: [Signer, Signer]): string {
  return hex(carrierScriptPubKey(pair[0].publicKey, pair[1].publicKey));
}

function hash256(data: Uint8Array): Buffer {
  return createHash("sha256").update(createHash("sha256").update(data).digest()).digest();
}

function varint(value: number): Buffer {
  if (value < 0xfd) return Buffer.from([value]);
  const out = Buffer.alloc(3);
  out[0] = 0xfd;
  out.writeUInt16LE(value, 1);
  return out;
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

function u64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function sign(digest: Uint8Array, signer: Signer): string {
  const signature = secp256k1.sign(digest, signer.secret, { prehash: false, lowS: true });
  return `${hex(signature.toDERRawBytes())}01`;
}

export interface BuiltTransaction {
  txid: string;
  wtxid: string;
  hex: string;
  /** The indexer's normalized view with prevouts, as `getblock` verbosity 3 would produce. */
  view: BitcoinTransaction;
}

export function buildTransaction(inputs: InputSpec[], outputs: OutputSpec[]): BuiltTransaction {
  const view: BitcoinTransaction = {
    txid: "",
    wtxid: "",
    version: 2,
    locktime: 0,
    inputs: inputs.map((input) => ({
      txid: input.prevout.txid,
      vout: input.prevout.vout,
      scriptSigHex: "",
      sequence: input.sequence,
      witness: [],
      prevout: {
        valueSats: input.prevout.valueSats,
        scriptPubKeyHex: input.prevout.scriptPubKeyHex,
        confirmed: true,
        blockHeight: input.prevout.height,
      },
    })),
    outputs: outputs.map((output, n) => ({ n, ...output })),
  };
  inputs.forEach((input, index) => {
    const target = view.inputs[index];
    if (!target) return;
    if (input.kind === "p2wpkh") {
      const program = Buffer.from(input.prevout.scriptPubKeyHex, "hex").subarray(2);
      const scriptCode = Buffer.concat([
        Buffer.from([0x76, 0xa9, 0x14]),
        program,
        Buffer.from([0x88, 0xac]),
      ]);
      const digest = segwitV0Digest(view, index, scriptCode, input.prevout.valueSats);
      target.witness = [sign(digest, input.signer), hex(input.signer.publicKey)];
    } else {
      const script = carrierWitnessScript(input.signers[0].publicKey, input.signers[1].publicKey);
      const digest = segwitV0Digest(view, index, script, input.prevout.valueSats);
      target.witness = [
        "",
        sign(digest, input.signers[0]),
        sign(digest, input.signers[1]),
        hex(script),
      ];
    }
  });
  const base = Buffer.concat([
    u32(view.version),
    varint(view.inputs.length),
    ...view.inputs.map((input) =>
      Buffer.concat([
        Buffer.from(input.txid as string, "hex").reverse(),
        u32(input.vout as number),
        varint(0),
        u32(input.sequence),
      ]),
    ),
    varint(view.outputs.length),
    ...view.outputs.map((output) => {
      const script = Buffer.from(output.scriptPubKeyHex, "hex");
      return Buffer.concat([u64(output.valueSats), varint(script.length), script]);
    }),
  ]);
  const witness = Buffer.concat(
    view.inputs.map((input) =>
      Buffer.concat([
        varint(input.witness.length),
        ...input.witness.map((item) => {
          const bytes = Buffer.from(item, "hex");
          return Buffer.concat([varint(bytes.length), bytes]);
        }),
      ]),
    ),
  );
  const locktime = u32(view.locktime);
  const full = Buffer.concat([
    base.subarray(0, 4),
    Buffer.from([0x00, 0x01]),
    base.subarray(4),
    witness,
    locktime,
  ]);
  const txid = hash256(Buffer.concat([base, locktime]))
    .reverse()
    .toString("hex");
  const wtxid = hash256(full).reverse().toString("hex");
  view.txid = txid;
  view.wtxid = wtxid;
  return { txid, wtxid, hex: full.toString("hex"), view };
}
