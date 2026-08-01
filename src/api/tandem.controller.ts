import {
  Controller,
  DefaultValuePipe,
  Get,
  Header,
  Inject,
  Param,
  ParseIntPipe,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AgreementQueryService } from "../agreement/agreement-query.service.js";
import { ReadinessService } from "../observability/readiness.service.js";
import { TandemQueryService } from "./tandem-query.service.js";

const PUBLIC_CACHE = "public, max-age=10, stale-while-revalidate=30";

@ApiTags("tandem")
@Controller("tandem")
export class TandemController {
  constructor(
    @Inject(TandemQueryService)
    private readonly queries: TandemQueryService,
    @Inject(ReadinessService)
    private readonly readiness: ReadinessService,
    @Inject(AgreementQueryService)
    private readonly agreements: AgreementQueryService,
  ) {}

  @Get("status")
  @Header("Cache-Control", "no-store")
  status() {
    return this.queries.status();
  }

  @Get("readiness")
  @Header("Cache-Control", "no-store")
  async readinessSnapshot() {
    const snapshot = await this.readiness.probe();
    if (!snapshot.ready) throw new ServiceUnavailableException(snapshot);
    return snapshot;
  }

  @Get("objects/:objectKey")
  @Header("Cache-Control", PUBLIC_CACHE)
  object(@Param("objectKey") objectKey: string) {
    return this.queries.object(objectKey);
  }

  @Get("carriers/:txid/:vout")
  @Header("Cache-Control", PUBLIC_CACHE)
  carrier(@Param("txid") txid: string, @Param("vout", ParseIntPipe) vout: number) {
    return this.queries.carrier(txid, vout);
  }

  @Get("events/:txid")
  @Header("Cache-Control", PUBLIC_CACHE)
  events(@Param("txid") txid: string) {
    return this.queries.events(txid);
  }

  @Get("invalid-events")
  @Header("Cache-Control", PUBLIC_CACHE)
  invalidEvents(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.queries.invalidEvents(limit);
  }

  @Get("reorgs")
  @Header("Cache-Control", PUBLIC_CACHE)
  reorgs(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.queries.reorgs(limit);
  }

  @Get("stats")
  @Header("Cache-Control", PUBLIC_CACHE)
  stats() {
    return this.queries.stats();
  }

  @Get("agreement/:height")
  @Header("Cache-Control", "public, max-age=60, immutable")
  @ApiOperation({ summary: "JCS-canonicalized Ed25519 checkpoint envelope" })
  agreement(@Param("height", ParseIntPipe) height: number) {
    return this.agreements.signedAt(height);
  }
}
