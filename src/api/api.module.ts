import { Module } from "@nestjs/common";
import { AgreementModule } from "../agreement/agreement.module.js";
import { ObservabilityModule } from "../observability/observability.module.js";
import { TandemController } from "./tandem.controller.js";
import { TandemQueryService } from "./tandem-query.service.js";

@Module({
  imports: [AgreementModule, ObservabilityModule],
  controllers: [TandemController],
  providers: [TandemQueryService],
})
export class ApiModule {}
