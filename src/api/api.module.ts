import { Module } from "@nestjs/common";
import { AgreementModule } from "../agreement/agreement.module.js";
import { BitcoinModule } from "../bitcoin/bitcoin.module.js";
import { IndexerModule } from "../indexer/indexer.module.js";
import { ObservabilityModule } from "../observability/observability.module.js";
import { VerifiedGatewayService } from "../verification/verified-gateway.service.js";
import { TandemController } from "./tandem.controller.js";
import { TandemCatalogService } from "./tandem-catalog.service.js";
import { TandemQueryService } from "./tandem-query.service.js";
import { VerifiedTandemController } from "./verified-tandem.controller.js";

@Module({
  imports: [AgreementModule, ObservabilityModule, IndexerModule, BitcoinModule],
  controllers: [TandemController, VerifiedTandemController],
  providers: [TandemQueryService, VerifiedGatewayService, TandemCatalogService],
})
export class ApiModule {}
