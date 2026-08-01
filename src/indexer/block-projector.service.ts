import { Inject, Injectable } from "@nestjs/common";
import type { BitcoinBlock } from "../protocol/bitcoin.js";
import { orderedBlockTransactions } from "../protocol/block-ordering.js";
import { type ProtocolObservation, TandemProtocolService } from "../protocol/protocol.service.js";

export interface ProjectedTransaction {
  txIndex: number;
  txid: string;
  wtxid: string;
  observation: ProtocolObservation;
}

@Injectable()
export class BlockProjectorService {
  constructor(@Inject(TandemProtocolService) private readonly protocol: TandemProtocolService) {}

  project(block: BitcoinBlock): ProjectedTransaction[] {
    return orderedBlockTransactions(block).map(({ txIndex, transaction }) => ({
      txIndex,
      txid: transaction.txid,
      wtxid: transaction.wtxid,
      observation: this.protocol.inspectTransaction(transaction),
    }));
  }
}
