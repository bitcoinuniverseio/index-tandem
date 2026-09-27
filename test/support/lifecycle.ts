import { createHash } from "node:crypto";
import {
  encodeMarkerScript,
  hexToBytes,
  initialStateRoot,
  NETWORK,
  namespaceCommitment,
} from "@bitcoinuniverse/tandem";
import {
  type Binding,
  type InitActivation,
  type ObjectRecord,
  type ReducedBlock,
  reduceBlock,
} from "../../src/indexer/block-reducer.js";
import type { BitcoinBlock, BitcoinTransaction } from "../../src/protocol/bitcoin.js";
import {
  buildTransaction,
  carrierHex,
  type Prevout,
  p2wpkhHex,
  type Signer,
  signerFrom,
  sortedPair,
} from "./tandem-tx.js";

export const SPEC_HASH = "caa77ce0122c0b833fc5f099191b54280b0481be325bdc98f2b48b0b905b923f";
export const INIT_HEIGHT = 200;
export const OPEN = INIT_HEIGHT + 1008;
export const CLOSE = OPEN + 4320;
const RBF = 0xffff_fffd;

let fundingCounter = 0;
function funding(signer: Signer, valueSats: bigint, height = INIT_HEIGHT - 10): Prevout {
  fundingCounter += 1;
  return {
    txid: createHash("sha256").update(`funding-${fundingCounter}`).digest("hex"),
    vout: 0,
    valueSats,
    scriptPubKeyHex: p2wpkhHex(signer),
    height,
  };
}

function carrierPrevout(txid: string, pair: [Signer, Signer], height: number): Prevout {
  return { txid, vout: 1, valueSats: 20_000n, scriptPubKeyHex: carrierHex(pair), height };
}

function coinbase(height: number): BitcoinTransaction {
  const txid = createHash("sha256").update(`coinbase-${height}`).digest("hex");
  return {
    txid,
    wtxid: txid,
    version: 2,
    locktime: 0,
    inputs: [{ coinbase: "00", scriptSigHex: "00", sequence: 0xffff_ffff, witness: [] }],
    outputs: [{ n: 0, valueSats: 5_000_000_000n, scriptPubKeyHex: "51" }],
  };
}

function block(height: number, transactions: BitcoinTransaction[]): BitcoinBlock {
  return {
    hash: createHash("sha256").update(`block-${height}`).digest("hex"),
    previousBlockHash: createHash("sha256")
      .update(`block-${height - 1}`)
      .digest("hex"),
    height,
    time: 1_700_000_000 + height,
    medianTime: 1_700_000_000 + height,
    transactions: [coinbase(height), ...transactions],
  };
}

function marker(value: Parameters<typeof encodeMarkerScript>[0]): string {
  return Buffer.from(encodeMarkerScript(value)).toString("hex");
}

function createTx(namespace: Uint8Array, pair: [Signer, Signer]) {
  const fee = 1_001n;
  const in0 = funding(pair[0], 100_000n);
  const in1 = funding(pair[1], 100_000n);
  return buildTransaction(
    [
      { kind: "p2wpkh", prevout: in0, signer: pair[0], sequence: RBF },
      { kind: "p2wpkh", prevout: in1, signer: pair[1], sequence: RBF },
    ],
    [
      {
        valueSats: 0n,
        scriptPubKeyHex: marker({
          operation: "CREATE",
          network: NETWORK.regtest,
          stateVout: 1,
          namespace,
        }),
      },
      { valueSats: 20_000n, scriptPubKeyHex: carrierHex(pair) },
      { valueSats: in0.valueSats - 10_000n - (fee + 1n) / 2n, scriptPubKeyHex: p2wpkhHex(pair[0]) },
      { valueSats: in1.valueSats - 10_000n - fee / 2n, scriptPubKeyHex: p2wpkhHex(pair[1]) },
    ],
  );
}

/** Signed INIT, CREATE, MARK, ROTATE, CLOSE, and exit transactions across five blocks. */
export function lifecycleFixture() {
  fundingCounter = 0;

  const initSigner = signerFrom(1);
  const initInput = funding(initSigner, 1_000_000n);
  const init = buildTransaction(
    [{ kind: "p2wpkh", prevout: initInput, signer: initSigner, sequence: 0xffff_ffff }],
    [
      {
        valueSats: 0n,
        scriptPubKeyHex: marker({
          operation: "INIT",
          network: NETWORK.regtest,
          openHeight: OPEN,
          closeHeight: CLOSE,
          carrierValue: 20_000n,
          refundDelay: 52_560,
          specHash: hexToBytes(SPEC_HASH, 32),
        }),
      },
      { valueSats: 999_000n, scriptPubKeyHex: p2wpkhHex(initSigner) },
    ],
  );
  const namespace = namespaceCommitment(
    NETWORK.regtest,
    hexToBytes(init.txid, 32),
    hexToBytes(SPEC_HASH, 32),
  );
  const binding: Binding = {
    networkCode: NETWORK.regtest,
    initTxid: init.txid,
    specHash: SPEC_HASH,
    namespace: Buffer.from(namespace).toString("hex"),
  };
  const pair = sortedPair(signerFrom(2), signerFrom(3));
  const rotated = sortedPair(signerFrom(4), signerFrom(5));
  const exitPair = sortedPair(signerFrom(6), signerFrom(7));
  const sameBlockPair = sortedPair(signerFrom(8), signerFrom(9));

  const create = createTx(namespace, pair);
  const create2 = createTx(namespace, exitPair);
  const sponsor = funding(pair[0], 50_000n, OPEN - 5);
  const mark = buildTransaction(
    [
      {
        kind: "carrier",
        prevout: carrierPrevout(create.txid, pair, OPEN),
        signers: pair,
        sequence: RBF,
      },
      { kind: "p2wpkh", prevout: sponsor, signer: pair[0], sequence: RBF },
    ],
    [
      {
        valueSats: 0n,
        scriptPubKeyHex: marker({
          operation: "MARK",
          network: NETWORK.regtest,
          stateVout: 1,
          namespace,
          sequence: 1,
          kind: 0,
          flags: 0,
          commitment: new Uint8Array(32).fill(7),
        }),
      },
      { valueSats: 20_000n, scriptPubKeyHex: carrierHex(pair) },
      { valueSats: 49_000n, scriptPubKeyHex: p2wpkhHex(pair[0]) },
    ],
  );
  const unmarked = buildTransaction(
    [
      {
        kind: "carrier",
        prevout: carrierPrevout(create2.txid, exitPair, OPEN),
        signers: exitPair,
        sequence: RBF,
      },
    ],
    [{ valueSats: 19_000n, scriptPubKeyHex: p2wpkhHex(exitPair[0]) }],
  );
  const rotate = buildTransaction(
    [
      {
        kind: "carrier",
        prevout: carrierPrevout(mark.txid, pair, OPEN + 1),
        signers: pair,
        sequence: RBF,
      },
      {
        kind: "p2wpkh",
        prevout: funding(rotated[0], 30_000n, OPEN),
        signer: rotated[0],
        sequence: RBF,
      },
      {
        kind: "p2wpkh",
        prevout: funding(rotated[1], 30_000n, OPEN),
        signer: rotated[1],
        sequence: RBF,
      },
    ],
    [
      {
        valueSats: 0n,
        scriptPubKeyHex: marker({
          operation: "ROTATE",
          network: NETWORK.regtest,
          stateVout: 1,
          namespace,
          sequence: 2,
        }),
      },
      { valueSats: 20_000n, scriptPubKeyHex: carrierHex(rotated) },
      { valueSats: 29_499n, scriptPubKeyHex: p2wpkhHex(rotated[0]) },
      { valueSats: 29_500n, scriptPubKeyHex: p2wpkhHex(rotated[1]) },
    ],
  );
  const close = buildTransaction(
    [
      {
        kind: "carrier",
        prevout: carrierPrevout(rotate.txid, rotated, OPEN + 2),
        signers: rotated,
        sequence: RBF,
      },
    ],
    [
      {
        valueSats: 0n,
        scriptPubKeyHex: marker({
          operation: "CLOSE",
          network: NETWORK.regtest,
          stateVout: 255,
          namespace,
          sequence: 3,
          reason: 0,
          commitment: new Uint8Array(32),
        }),
      },
      { valueSats: 9_500n, scriptPubKeyHex: p2wpkhHex(rotated[0]) },
      { valueSats: 9_500n, scriptPubKeyHex: p2wpkhHex(rotated[1]) },
    ],
  );
  const create3 = createTx(namespace, sameBlockPair);
  const sameBlockMark = buildTransaction(
    [
      {
        kind: "carrier",
        prevout: carrierPrevout(create3.txid, sameBlockPair, OPEN + 3),
        signers: sameBlockPair,
        sequence: RBF,
      },
      {
        kind: "p2wpkh",
        prevout: funding(sameBlockPair[0], 50_000n, OPEN),
        signer: sameBlockPair[0],
        sequence: RBF,
      },
    ],
    [
      {
        valueSats: 0n,
        scriptPubKeyHex: marker({
          operation: "MARK",
          network: NETWORK.regtest,
          stateVout: 1,
          namespace,
          sequence: 1,
          kind: 1,
          flags: 0,
          commitment: new Uint8Array(32).fill(9),
        }),
      },
      { valueSats: 20_000n, scriptPubKeyHex: carrierHex(sameBlockPair) },
      { valueSats: 49_000n, scriptPubKeyHex: p2wpkhHex(sameBlockPair[0]) },
    ],
  );

  const blocks = [
    block(INIT_HEIGHT, [init.view]),
    block(OPEN, [create.view, create2.view]),
    block(OPEN + 1, [mark.view, unmarked.view]),
    block(OPEN + 2, [rotate.view]),
    block(OPEN + 3, [close.view, create3.view, sameBlockMark.view]),
  ];
  return { binding, namespace, init, create, rotate, close, rotated, blocks, block };
}

/** Reduces fixture blocks in order, as the sync loop would. */
export function replay(fixture: ReturnType<typeof lifecycleFixture>): ReducedBlock[] {
  let activation: InitActivation | null = null;
  let previousRoot = initialStateRoot(fixture.namespace);
  let objects: ReadonlyMap<string, ObjectRecord> = new Map();
  return fixture.blocks.map((item) => {
    const reduced = reduceBlock({
      binding: fixture.binding,
      activation,
      previousRoot,
      objects,
      block: item,
    });
    activation = reduced.activation;
    previousRoot = Uint8Array.from(Buffer.from(reduced.chainedRoot, "hex"));
    objects = reduced.objects;
    return reduced;
  });
}
