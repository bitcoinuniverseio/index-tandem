import { Module } from "@nestjs/common";
import { AgreementSignerService } from "./agreement.service.js";
import { AgreementQueryService } from "./agreement-query.service.js";

@Module({
  providers: [AgreementSignerService, AgreementQueryService],
  exports: [AgreementSignerService, AgreementQueryService],
})
export class AgreementModule {}
