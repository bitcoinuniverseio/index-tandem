import { Module } from "@nestjs/common";
import { AgreementModule } from "../agreement/agreement.module.js";
import { BitcoinModule } from "../bitcoin/bitcoin.module.js";
import { MetricsService } from "./metrics.service.js";
import { ObservabilityController } from "./observability.controller.js";
import { ReadinessService } from "./readiness.service.js";

@Module({
  imports: [BitcoinModule, AgreementModule],
  controllers: [ObservabilityController],
  providers: [ReadinessService, MetricsService],
  exports: [ReadinessService, MetricsService],
})
export class ObservabilityModule {}
