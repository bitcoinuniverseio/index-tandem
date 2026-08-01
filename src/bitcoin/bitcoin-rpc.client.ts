import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfiguration } from "../config/configuration.js";
import type { BitcoinBlock, BitcoinOutput, BitcoinTransaction } from "../protocol/bitcoin.js";

interface RpcResponse<T> {
  result: T;
  error: { code: number; message: string } | null;
}

interface RpcTransaction {
  txid: string;
  hash?: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid?: string;
    vout?: number;
    coinbase?: string;
    sequence: number;
    txinwitness?: string[];
    prevout?: { value: number; height?: number; scriptPubKey: { hex: string } };
  }>;
  vout: Array<{ value: number; n: number; scriptPubKey: { hex: string } }>;
}

interface RpcBlock {
  hash: string;
  height: number;
  previousblockhash?: string;
  time: number;
  mediantime: number;
  tx: RpcTransaction[];
}

export interface BlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  initialblockdownload: boolean;
  pruned: boolean;
}

export class BitcoinRpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | null,
    message: string,
  ) {
    super(`Bitcoin RPC ${method}: ${message}`);
    this.name = "BitcoinRpcError";
  }
}

export function btcToSats(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error("invalid Bitcoin amount");
  return BigInt(Math.round(value * 100_000_000));
}

function normalizeOutput(output: RpcTransaction["vout"][number]): BitcoinOutput {
  return {
    n: output.n,
    valueSats: btcToSats(output.value),
    scriptPubKeyHex: output.scriptPubKey.hex.toLowerCase(),
  };
}

function normalizeTransaction(transaction: RpcTransaction): BitcoinTransaction {
  return {
    txid: transaction.txid.toLowerCase(),
    wtxid: (transaction.hash ?? transaction.txid).toLowerCase(),
    version: transaction.version,
    locktime: transaction.locktime,
    inputs: transaction.vin.map((input) => ({
      ...(input.txid ? { txid: input.txid.toLowerCase() } : {}),
      ...(input.vout === undefined ? {} : { vout: input.vout }),
      ...(input.coinbase ? { coinbase: input.coinbase.toLowerCase() } : {}),
      sequence: input.sequence,
      witness: input.txinwitness?.map((item) => item.toLowerCase()) ?? [],
      ...(input.prevout
        ? {
            prevout: {
              valueSats: btcToSats(input.prevout.value),
              scriptPubKeyHex: input.prevout.scriptPubKey.hex.toLowerCase(),
              confirmed: input.prevout.height !== undefined,
              ...(input.prevout.height === undefined ? {} : { blockHeight: input.prevout.height }),
            },
          }
        : {}),
    })),
    outputs: [...transaction.vout].sort((left, right) => left.n - right.n).map(normalizeOutput),
  };
}

@Injectable()
export class BitcoinRpcClient {
  private readonly url: string;
  private readonly authorization: string;
  private readonly timeoutMs: number;

  constructor(@Inject(ConfigService) config: ConfigService<AppConfiguration, true>) {
    const bitcoin = config.get("bitcoin", { infer: true });
    this.url = bitcoin.rpcUrl;
    this.authorization = `Basic ${Buffer.from(`${bitcoin.rpcUser}:${bitcoin.rpcPassword}`).toString("base64")}`;
    this.timeoutMs = bitcoin.rpcTimeoutMs;
  }

  async call<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { authorization: this.authorization, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "index-tandem-a", method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new BitcoinRpcError(method, null, `HTTP ${response.status}`);
      const body = (await response.json()) as RpcResponse<T>;
      if (body.error) throw new BitcoinRpcError(method, body.error.code, body.error.message);
      return body.result;
    } catch (error) {
      if (error instanceof BitcoinRpcError) throw error;
      throw new BitcoinRpcError(
        method,
        null,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  getBlockchainInfo(): Promise<BlockchainInfo> {
    return this.call("getblockchaininfo");
  }

  getBlockHash(height: number): Promise<string> {
    return this.call("getblockhash", [height]);
  }

  async getBlock(hash: string): Promise<BitcoinBlock> {
    const block = await this.call<RpcBlock>("getblock", [hash, 3]);
    return {
      hash: block.hash.toLowerCase(),
      previousBlockHash: block.previousblockhash?.toLowerCase() ?? null,
      height: block.height,
      time: block.time,
      medianTime: block.mediantime,
      transactions: block.tx.map(normalizeTransaction),
    };
  }

  async getRawTransaction(txid: string): Promise<BitcoinTransaction> {
    return normalizeTransaction(await this.call<RpcTransaction>("getrawtransaction", [txid, true]));
  }

  getRawMempool(): Promise<Record<string, unknown>> {
    return this.call("getrawmempool", [true]);
  }
}
