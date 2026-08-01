import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AgreementSignerService } from "../agreement/agreement.service.js";
import { BitcoinRpcClient } from "../bitcoin/bitcoin-rpc.client.js";
import type { AppConfiguration } from "../config/configuration.js";

export interface ReadinessInput {
  configurationValid: boolean;
  databaseAvailable: boolean;
  coreAvailable: boolean;
  coreNetworkMatches: boolean;
  coreInitialBlockDownload: boolean;
  nodeHeight: number | null;
  canonicalHeight: number | null;
  checkpointHeight: number | null;
  maxBlockLag: number;
  signerConfigured: boolean;
}

export interface ReadinessSnapshot extends ReadinessInput {
  ready: boolean;
  reasons: string[];
}

export function evaluateReadiness(input: ReadinessInput): ReadinessSnapshot {
  const reasons: string[] = [];
  if (!input.configurationValid) reasons.push("configuration_invalid");
  if (!input.databaseAvailable) reasons.push("database_unavailable");
  if (!input.coreAvailable) reasons.push("bitcoin_core_unavailable");
  if (!input.coreNetworkMatches) reasons.push("bitcoin_network_mismatch");
  if (input.coreInitialBlockDownload) reasons.push("bitcoin_core_initial_block_download");
  if (input.nodeHeight === null) reasons.push("node_height_unknown");
  if (input.canonicalHeight === null) reasons.push("canonical_tip_missing");
  if (
    input.nodeHeight !== null &&
    input.canonicalHeight !== null &&
    input.nodeHeight - input.canonicalHeight > input.maxBlockLag
  ) {
    reasons.push("canonical_tip_stale");
  }
  if (input.checkpointHeight === null || input.checkpointHeight !== input.canonicalHeight) {
    reasons.push("checkpoint_incomplete");
  }
  if (!input.signerConfigured) reasons.push("agreement_signer_unavailable");
  return { ...input, ready: reasons.length === 0, reasons };
}

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @Inject(BitcoinRpcClient)
    private readonly rpc: BitcoinRpcClient,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppConfiguration, true>,
    @Inject(AgreementSignerService)
    private readonly signer: AgreementSignerService,
  ) {}

  async probe(): Promise<ReadinessSnapshot> {
    const deployment = this.config.get("deployment", { infer: true });
    const bitcoin = this.config.get("bitcoin", { infer: true });
    const readiness = this.config.get("readiness", { infer: true });
    let databaseAvailable = false;
    let canonicalHeight: number | null = null;
    let checkpointHeight: number | null = null;
    try {
      await this.dataSource.query("SELECT 1");
      databaseAvailable = true;
      const tip = (await this.dataSource.query(
        "SELECT height FROM tandem_blocks ORDER BY height DESC LIMIT 1",
      )) as Array<{ height: number }>;
      canonicalHeight = tip[0]?.height ?? null;
      const checkpoint = (await this.dataSource.query(
        "SELECT height FROM tandem_checkpoints ORDER BY height DESC LIMIT 1",
      )) as Array<{ height: number }>;
      checkpointHeight = checkpoint[0]?.height ?? null;
    } catch {
      databaseAvailable = false;
    }
    let coreAvailable = false;
    let coreNetworkMatches = false;
    let coreInitialBlockDownload = true;
    let nodeHeight: number | null = null;
    try {
      const info = await this.rpc.getBlockchainInfo();
      coreAvailable = true;
      coreNetworkMatches = info.chain === bitcoin.expectedChain;
      coreInitialBlockDownload = info.initialblockdownload;
      nodeHeight = info.blocks;
    } catch {
      coreAvailable = false;
    }
    return evaluateReadiness({
      configurationValid: Boolean(deployment.protocolId),
      databaseAvailable,
      coreAvailable,
      coreNetworkMatches,
      coreInitialBlockDownload,
      nodeHeight,
      canonicalHeight,
      checkpointHeight,
      maxBlockLag: readiness.maxBlockLag,
      signerConfigured: this.signer.configured(),
    });
  }
}
