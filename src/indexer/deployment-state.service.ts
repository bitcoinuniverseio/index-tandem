import { Injectable } from "@nestjs/common";
import type { InitActivation } from "./block-reducer.js";

/**
 * `unconfigured`: no TANDEM_INIT_TXID yet. `awaiting_init`: configured but not yet confirmed on the
 * canonical chain. `active`: the configured INIT confirmed and validated. `failed_init`: it
 * confirmed and failed validation (spec 11.1 FAILED_INIT).
 */
export type InitPhase = "unconfigured" | "awaiting_init" | "active" | "failed_init";

export interface NodeTip {
  chain: string;
  height: number;
  hash: string;
  initialBlockDownload: boolean;
}

/** In-process view of how far the configured deployment has been resolved from the chain. */
@Injectable()
export class DeploymentStateService {
  phase: InitPhase = "unconfigured";
  activation: InitActivation | null = null;
  initSeenInMempool = false;
  initConfigMismatch: string | null = null;
  node: NodeTip | null = null;
  lastSyncAt: string | null = null;
  lastError: string | null = null;

  setActivation(activation: InitActivation | null, configuredInit: boolean): void {
    this.activation = activation;
    if (!configuredInit) this.phase = "unconfigured";
    else if (!activation) this.phase = "awaiting_init";
    else this.phase = activation.valid ? "active" : "failed_init";
    if (activation) this.initSeenInMempool = false;
  }
}
