/**
 * Validates a candidate configured INIT with the same evidence builder and reducer the indexer uses.
 *
 * Usage: node dist/tools/validate-init.js <init_txid>
 * Environment: TANDEM_NETWORK, TANDEM_SPEC_HASH, BITCOIN_RPC_URL, BITCOIN_RPC_USER,
 * BITCOIN_RPC_PASSWORD.
 *
 * A confirmed INIT is validated in its actual block (spec 9.1, including the 1,008-block lead from
 * its confirmation height). An unconfirmed INIT is validated provisionally as if it confirmed in the
 * next block, the earliest height it can reach. Prints one JSON object. Exit codes: 0 confirmed and
 * valid, 2 invalid, 3 unconfirmed and provisionally valid, 4 unknown to Core, 1 usage or RPC error.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  hexToBytes,
  initialStateRoot,
  NETWORK,
  type NetworkName,
  namespaceCommitment,
  REASON,
  type ReasonCode,
  reasonName,
} from "@bitcoinuniverse/tandem";
import {
  normalizeBlock,
  normalizeTransaction,
  type RpcBlock,
  type RpcTransaction,
} from "../bitcoin/bitcoin-rpc.client.js";
import { reduceBlock } from "../indexer/block-reducer.js";
import type { BitcoinTransaction } from "../protocol/bitcoin.js";

const HASH = /^[0-9a-f]{64}$/;

class Exit extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

function fail(message: string, code = 1): never {
  throw new Exit(message, code);
}

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const url = process.env.BITCOIN_RPC_URL ?? fail("BITCOIN_RPC_URL is required");
  const auth = Buffer.from(
    `${process.env.BITCOIN_RPC_USER ?? ""}:${process.env.BITCOIN_RPC_PASSWORD ?? ""}`,
  ).toString("base64");
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "validate-init", method, params }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await response.json().catch(() => null)) as {
    result: T;
    error: { code: number; message: string } | null;
  } | null;
  if (!body) throw new Error(`${method}: HTTP ${response.status}`);
  if (body.error) throw Object.assign(new Error(`${method}: ${body.error.message}`), body.error);
  return body.result;
}

/** SHA256 of the protocol specification bundled with the reference package. */
function bundledSpecHash(): string {
  const require = createRequire(import.meta.url);
  const packageDir = dirname(require.resolve("@bitcoinuniverse/tandem/package.json"));
  return createHash("sha256")
    .update(readFileSync(join(packageDir, "tandem.md")))
    .digest("hex");
}

/** Fills prevouts of an unconfirmed transaction from Core (txindex or mempool parents). */
async function withPrevouts(raw: RpcTransaction): Promise<BitcoinTransaction> {
  const inputs = [];
  for (const input of raw.vin) {
    if (!input.txid || input.vout === undefined) {
      inputs.push(input);
      continue;
    }
    const parent = await rpc<RpcTransaction & { blockhash?: string }>("getrawtransaction", [
      input.txid,
      true,
    ]);
    const output = parent.vout.find((item) => item.n === input.vout);
    if (!output) throw new Error(`prevout ${input.txid}:${input.vout} not found`);
    let height: number | undefined;
    if (parent.blockhash) {
      const header = await rpc<{ height: number; confirmations: number }>("getblockheader", [
        parent.blockhash,
      ]);
      if (header.confirmations > 0) height = header.height;
    }
    inputs.push({
      ...input,
      prevout: {
        value: output.value,
        scriptPubKey: output.scriptPubKey,
        ...(height === undefined ? {} : { height }),
      },
    });
  }
  return normalizeTransaction({ ...raw, vin: inputs });
}

async function main(): Promise<number> {
  const txid = (process.argv[2] ?? "").toLowerCase();
  if (!HASH.test(txid)) fail("usage: validate-init <init_txid as 64 lowercase hex>");
  const networkName = (process.env.TANDEM_NETWORK ?? "") as NetworkName;
  if (!(networkName in NETWORK)) fail("TANDEM_NETWORK is missing or unsupported");
  const specHash = (process.env.TANDEM_SPEC_HASH ?? "").toLowerCase();
  if (!HASH.test(specHash)) fail("TANDEM_SPEC_HASH must be 32-byte hex");
  const bundled = bundledSpecHash();
  if (bundled !== specHash) {
    fail(`TANDEM_SPEC_HASH ${specHash} does not match the bundled specification ${bundled}`);
  }
  const networkCode = NETWORK[networkName];
  const expectedChain = networkName === "mainnet" ? "main" : networkName;
  const info = await rpc<{ chain: string; blocks: number; bestblockhash: string }>(
    "getblockchaininfo",
  );
  if (info.chain !== expectedChain) {
    fail(`Bitcoin Core chain ${info.chain} does not match ${expectedChain}`);
  }
  let location: RpcTransaction & { blockhash?: string };
  try {
    location = await rpc("getrawtransaction", [txid, true]);
  } catch (error) {
    fail(`INIT ${txid} is unknown to Bitcoin Core: ${(error as Error).message}`, 4);
  }
  const namespace = Buffer.from(
    namespaceCommitment(networkCode, hexToBytes(txid, 32), hexToBytes(specHash, 32)),
  ).toString("hex");
  const binding = { networkCode, initTxid: txid, specHash, namespace };
  let confirmed = false;
  let block: ReturnType<typeof normalizeBlock>;
  if (location.blockhash) {
    const header = await rpc<{ confirmations: number }>("getblockheader", [location.blockhash]);
    confirmed = header.confirmations > 0;
  }
  if (confirmed && location.blockhash) {
    block = normalizeBlock(await rpc<RpcBlock>("getblock", [location.blockhash, 3]));
  } else {
    const transaction = await withPrevouts(location);
    block = {
      hash: "00".repeat(32),
      previousBlockHash: info.bestblockhash,
      height: info.blocks + 1,
      time: 0,
      medianTime: 0,
      transactions: [
        {
          txid: "00".repeat(32),
          wtxid: "00".repeat(32),
          version: 2,
          locktime: 0,
          inputs: [{ coinbase: "00", scriptSigHex: "00", sequence: 0xffff_ffff, witness: [] }],
          outputs: [],
        },
        transaction,
      ],
    };
  }
  const reduced = reduceBlock({
    binding,
    activation: null,
    previousRoot: initialStateRoot(hexToBytes(namespace, 32)),
    objects: new Map(),
    block,
  });
  const activation = reduced.activation;
  const pendingParent =
    !confirmed && activation.reason === REASON.UNCONFIRMED_OR_SAME_BLOCK_PREVOUT;
  const result = {
    txid,
    network: networkName,
    protocolId: `tndm:${networkName}:${txid}`,
    specHash,
    namespace,
    confirmed,
    height: confirmed ? activation.height : null,
    blockHash: confirmed ? activation.blockHash : null,
    evaluatedAtHeight: activation.height,
    openHeight: activation.openHeight,
    closeHeight: activation.closeHeight,
    valid: activation.valid,
    reason: activation.reason,
    reasonName: reasonName(activation.reason as ReasonCode),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (confirmed) return activation.valid ? 0 : 2;
  return activation.valid || pendingParent ? 3 : 2;
}

// Exit codes are set, not forced: process.exit() with open fetch sockets aborts on Windows.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ error: message })}\n`);
    process.exitCode = error instanceof Exit ? error.code : 1;
  },
);
