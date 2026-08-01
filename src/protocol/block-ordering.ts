import type { BitcoinBlock, BitcoinTransaction } from "./bitcoin.js";

export interface OrderedTransaction {
  txIndex: number;
  transaction: BitcoinTransaction;
}

export function orderedBlockTransactions(block: BitcoinBlock): OrderedTransaction[] {
  const seen = new Set<string>();
  return block.transactions.map((transaction, txIndex) => {
    if (seen.has(transaction.txid)) throw new Error(`duplicate txid in block: ${transaction.txid}`);
    seen.add(transaction.txid);
    if (txIndex === 0 && !transaction.inputs.some((input) => input.coinbase)) {
      throw new Error("first transaction must be coinbase");
    }
    if (txIndex > 0 && transaction.inputs.some((input) => input.coinbase)) {
      throw new Error("coinbase transaction must be first");
    }
    return { txIndex, transaction };
  });
}
