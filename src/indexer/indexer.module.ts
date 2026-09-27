import { Module } from "@nestjs/common";
import { BitcoinModule } from "../bitcoin/bitcoin.module.js";
import { TandemProtocolService } from "../protocol/protocol.service.js";
import { BlockProjectorService } from "./block-projector.service.js";
import { DeploymentStateService } from "./deployment-state.service.js";
import { IndexerStore } from "./indexer.store.js";
import { MempoolOverlayService } from "./mempool-overlay.service.js";
import { ReorgService } from "./reorg.service.js";
import { SyncService } from "./sync.service.js";

@Module({
  imports: [BitcoinModule],
  providers: [
    TandemProtocolService,
    BlockProjectorService,
    MempoolOverlayService,
    IndexerStore,
    { provide: "ReorgStore", useExisting: IndexerStore },
    ReorgService,
    DeploymentStateService,
    SyncService,
  ],
  exports: [
    TandemProtocolService,
    BlockProjectorService,
    MempoolOverlayService,
    IndexerStore,
    DeploymentStateService,
  ],
})
export class IndexerModule {}
