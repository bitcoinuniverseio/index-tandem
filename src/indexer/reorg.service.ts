import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfiguration } from "../config/configuration.js";

export interface ReorgPlan {
  oldTipHeight: number;
  ancestorHeight: number;
  rollbackHeights: number[];
}

export class ReorgBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReorgBoundaryError";
  }
}

export function planReorgRollback(
  oldTipHeight: number,
  ancestorHeight: number,
  initHeight: number,
): ReorgPlan {
  if (![oldTipHeight, ancestorHeight, initHeight].every(Number.isSafeInteger)) {
    throw new ReorgBoundaryError("reorg heights must be safe integers");
  }
  if (ancestorHeight < initHeight - 1) {
    throw new ReorgBoundaryError("reorg ancestor crosses the configured INIT boundary");
  }
  if (ancestorHeight >= oldTipHeight) {
    throw new ReorgBoundaryError("reorg ancestor must be below the old tip");
  }
  const rollbackHeights: number[] = [];
  for (let height = oldTipHeight; height > ancestorHeight; height -= 1) {
    rollbackHeights.push(height);
  }
  return { oldTipHeight, ancestorHeight, rollbackHeights };
}

export interface ReorgStore {
  rollback(
    plan: ReorgPlan,
    journal: { oldTipHash: string; ancestorHash: string; newTipHash: string },
  ): Promise<void>;
}

@Injectable()
export class ReorgService {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<AppConfiguration, true>,
    @Inject("ReorgStore")
    private readonly store: ReorgStore,
  ) {}

  rollback(
    oldTipHeight: number,
    ancestorHeight: number,
    journal: { oldTipHash: string; ancestorHash: string; newTipHash: string },
  ): Promise<void> {
    const initHeight = this.config.get("deployment", { infer: true }).initHeight;
    return this.store.rollback(
      planReorgRollback(oldTipHeight, ancestorHeight, initHeight),
      journal,
    );
  }
}
