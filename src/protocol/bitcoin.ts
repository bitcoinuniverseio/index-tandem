export interface BitcoinPrevout {
  valueSats: bigint;
  scriptPubKeyHex: string;
  confirmed: boolean;
  blockHeight?: number;
}

export interface BitcoinInput {
  txid?: string;
  vout?: number;
  coinbase?: string;
  sequence: number;
  witness: string[];
  prevout?: BitcoinPrevout;
}

export interface BitcoinOutput {
  n: number;
  valueSats: bigint;
  scriptPubKeyHex: string;
}

export interface BitcoinTransaction {
  txid: string;
  wtxid: string;
  version: number;
  locktime: number;
  inputs: BitcoinInput[];
  outputs: BitcoinOutput[];
}

export interface BitcoinBlock {
  hash: string;
  previousBlockHash: string | null;
  height: number;
  time: number;
  medianTime: number;
  transactions: BitcoinTransaction[];
}
