import { Inject, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { TandemMempoolEntity } from "../database/entities.js";
import type { BitcoinTransaction } from "../protocol/bitcoin.js";
import { type ProtocolObservation, TandemProtocolService } from "../protocol/protocol.service.js";

@Injectable()
export class MempoolOverlayService {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @Inject(TandemProtocolService)
    private readonly protocol: TandemProtocolService,
  ) {}

  async observe(
    transaction: BitcoinTransaction,
    seenAt = new Date(),
  ): Promise<ProtocolObservation> {
    const observation = this.protocol.inspectTransaction(transaction);
    if (observation.classification === "none") return observation;
    const reason = observation.classification === "invalid" ? observation.reason : null;
    const repository = this.dataSource.getRepository(TandemMempoolEntity);
    const row = repository.create({
      txid: transaction.txid,
      wtxid: transaction.wtxid,
      classification: observation.classification,
      reason,
      rawObservation: JSON.parse(JSON.stringify(observation)) as Record<string, unknown>,
      lastSeenAt: seenAt,
    });
    await repository.save(row);
    return observation;
  }

  async reconcile(liveTxids: ReadonlySet<string>): Promise<number> {
    const rows = await this.dataSource
      .getRepository(TandemMempoolEntity)
      .find({ select: ["txid"] });
    const stale = rows.filter((row) => !liveTxids.has(row.txid)).map((row) => row.txid);
    if (stale.length === 0) return 0;
    await this.dataSource
      .createQueryBuilder()
      .delete()
      .from(TandemMempoolEntity)
      .where("txid IN (:...txids)", { txids: stale })
      .execute();
    return stale.length;
  }

  clearConfirmed(txids: readonly string[]): Promise<unknown> {
    if (txids.length === 0) return Promise.resolve(undefined);
    return this.dataSource
      .createQueryBuilder()
      .delete()
      .from(TandemMempoolEntity)
      .where("txid IN (:...txids)", { txids })
      .execute();
  }
}
