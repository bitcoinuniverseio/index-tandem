/**
 * Regtest probe: mines two coinbase outputs to fresh P2WPKH keys, matures them, then mines one
 * correctly signed CREATE. Bitcoin Core accepting the transaction proves the BIP143 digest used by
 * the evidence builder. Before H_open the indexer must classify it as BAD_HEIGHT_OR_PHASE (30),
 * which is reached only after every signature, script, and fee check passes.
 *
 * Usage: RPC_URL=... RPC_USER=... RPC_PASSWORD=... TANDEM_NAMESPACE=<hex> npx tsx scripts/regtest-create-probe.ts
 */
import { randomBytes } from "node:crypto";
import { encodeMarkerScript, NETWORK } from "@bitcoinuniverse/tandem";
import {
  buildTransaction,
  carrierHex,
  p2wpkhHex,
  signerFrom,
  sortedPair,
} from "../test/support/tandem-tx.js";

const url = process.env.RPC_URL ?? "http://127.0.0.1:38450";
const auth = `Basic ${Buffer.from(`${process.env.RPC_USER}:${process.env.RPC_PASSWORD}`).toString("base64")}`;
const namespace = process.env.TANDEM_NAMESPACE ?? "";

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "probe", method, params }),
  });
  const body = (await response.json()) as { result: T; error: { message: string } | null };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function addressFor(publicKeyHex: string): Promise<string> {
  const info = await rpc<{ descriptor: string }>("getdescriptorinfo", [`wpkh(${publicKeyHex})`]);
  const [address] = await rpc<string[]>("deriveaddresses", [info.descriptor]);
  return address as string;
}

async function coinbaseTo(address: string, scriptHex: string) {
  const [hash] = await rpc<string[]>("generatetoaddress", [1, address]);
  const block = await rpc<{
    height: number;
    tx: Array<{
      txid: string;
      vout: Array<{ n: number; value: number; scriptPubKey: { hex: string } }>;
    }>;
  }>("getblock", [hash, 2]);
  const coinbase = block.tx[0];
  const output = coinbase?.vout.find((item) => item.scriptPubKey.hex === scriptHex);
  if (!coinbase || !output) throw new Error("coinbase output not found");
  return {
    txid: coinbase.txid,
    vout: output.n,
    valueSats: BigInt(Math.round(output.value * 1e8)),
    scriptPubKeyHex: scriptHex,
    height: block.height,
  };
}

const pair = sortedPair(signerFrom(randomBytes(32)), signerFrom(randomBytes(32)));
const [signer0, signer1] = pair;
const address0 = await addressFor(Buffer.from(signer0.publicKey).toString("hex"));
const address1 = await addressFor(Buffer.from(signer1.publicKey).toString("hex"));
const prevout0 = await coinbaseTo(address0, p2wpkhHex(signer0));
const prevout1 = await coinbaseTo(address1, p2wpkhHex(signer1));
await rpc("generatetoaddress", [100, address0]);

const fee = 1_001n;
const debit0 = 10_000n + (fee + 1n) / 2n;
const debit1 = 10_000n + fee / 2n;
const marker = Buffer.from(
  encodeMarkerScript({
    operation: "CREATE",
    network: NETWORK.regtest,
    stateVout: 1,
    namespace: Uint8Array.from(Buffer.from(namespace, "hex")),
  }),
).toString("hex");
const create = buildTransaction(
  [
    { kind: "p2wpkh", prevout: prevout0, signer: signer0, sequence: 0xffff_fffd },
    { kind: "p2wpkh", prevout: prevout1, signer: signer1, sequence: 0xffff_fffd },
  ],
  [
    { valueSats: 0n, scriptPubKeyHex: marker },
    { valueSats: 20_000n, scriptPubKeyHex: carrierHex(pair) },
    { valueSats: prevout0.valueSats - debit0, scriptPubKeyHex: p2wpkhHex(signer0) },
    { valueSats: prevout1.valueSats - debit1, scriptPubKeyHex: p2wpkhHex(signer1) },
  ],
);
const accepted = await rpc<string>("sendrawtransaction", [create.hex]);
const [minedHash] = await rpc<string[]>("generatetoaddress", [1, address0]);
const header = await rpc<{ height: number }>("getblockheader", [minedHash]);
console.log(
  JSON.stringify({ createTxid: accepted, computedTxid: create.txid, minedHeight: header.height }),
);
