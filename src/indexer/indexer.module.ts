import { Module } from "@nestjs/common";
import { TandemProtocolService } from "../protocol/protocol.service.js";
import { BlockProjectorService } from "./block-projector.service.js";
import { SqlDerivedStateRebuilder } from "./derived-state.rebuilder.js";
import { IndexerStore } from "./indexer.store.js";
import { MempoolOverlayService } from "./mempool-overlay.service.js";
import { ReorgService } from "./reorg.service.js";

@Module({
  providers: [
    TandemProtocolService,
    BlockProjectorService,
    MempoolOverlayService,
    SqlDerivedStateRebuilder,
    { provide: "DerivedStateRebuilder", useExisting: SqlDerivedStateRebuilder },
    IndexerStore,
    { provide: "ReorgStore", useExisting: IndexerStore },
    ReorgService,
  ],
  exports: [TandemProtocolService, BlockProjectorService, MempoolOverlayService, IndexerStore],
})
export class IndexerModule {}
