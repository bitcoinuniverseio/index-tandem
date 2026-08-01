import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import type { AppConfiguration } from "../config/configuration.js";
import { AgreementSignerService, type AgreementTuple } from "./agreement.service.js";

interface CheckpointRow {
  height: number;
  blockHash: string;
  eventRoot: string;
  objectStateRoot: string;
  chainedRoot: string;
  foundingCreated: string;
  allObjects: string;
  activeObjects: string;
}

@Injectable()
export class AgreementQueryService {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppConfiguration, true>,
    @Inject(AgreementSignerService)
    private readonly signer: AgreementSignerService,
  ) {}

  async signedAt(height: number) {
    const rows = (await this.dataSource.query(
      `SELECT height, block_hash AS blockHash, event_root AS eventRoot,
        object_state_root AS objectStateRoot, chained_root AS chainedRoot,
        CAST(founding_created AS CHAR) AS foundingCreated,
        CAST(all_objects AS CHAR) AS allObjects,
        CAST(active_objects AS CHAR) AS activeObjects
       FROM tandem_checkpoints WHERE height = ? LIMIT 1`,
      [height],
    )) as CheckpointRow[];
    const row = rows[0];
    if (!row) throw new NotFoundException("checkpoint not found");
    const deployment = this.config.get("deployment", { infer: true });
    const release = this.signer.releaseIdentity();
    const tuple: AgreementTuple = {
      schema: "urn:tandem:agreement-tuple:v1",
      protocol_id: deployment.protocolId,
      height: String(row.height),
      block_hash: row.blockHash,
      event_root: row.eventRoot,
      object_state_root: row.objectStateRoot,
      chained_root: row.chainedRoot,
      founding_created: row.foundingCreated,
      all_objects: row.allObjects,
      active_objects: row.activeObjects,
      parser_commit: release.parserCommit,
      indexer_commit: release.indexerCommit,
      parser_binary_sha256: release.parserBinarySha256,
      indexer_binary_sha256: release.indexerBinarySha256,
    };
    return this.signer.sign(tuple);
  }
}
