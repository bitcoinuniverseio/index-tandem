import {
  Controller,
  DefaultValuePipe,
  Get,
  Header,
  Inject,
  Param,
  ParseIntPipe,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { VerifiedGatewayService } from "../verification/verified-gateway.service.js";
import { TandemQueryService } from "./tandem-query.service.js";

const VERIFIED_CACHE = "no-store";

@ApiTags("tandem-verified")
@Controller("tandem/verified")
export class VerifiedTandemController {
  constructor(
    @Inject(TandemQueryService)
    private readonly queries: TandemQueryService,
    @Inject(VerifiedGatewayService)
    private readonly gateway: VerifiedGatewayService,
  ) {}

  @Get("status")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({ summary: "Verified Tandem indexer status" })
  async status() {
    return this.gateway.execute(() => this.queries.status());
  }

  @Get("objects")
  @Header("Cache-Control", VERIFIED_CACHE)
  async objects(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.gateway.execute(() => this.queries.objects(limit));
  }

  @Get("objects/:key")
  @Header("Cache-Control", VERIFIED_CACHE)
  async object(@Param("key") key: string) {
    return this.gateway.execute(() => this.queries.object(key));
  }

  @Get("events/:txid")
  @Header("Cache-Control", VERIFIED_CACHE)
  async events(@Param("txid") txid: string) {
    return this.gateway.execute(() => this.queries.events(txid));
  }

  @Get("transactions/:txid")
  @Header("Cache-Control", VERIFIED_CACHE)
  async transaction(@Param("txid") txid: string) {
    return this.gateway.execute(() => this.queries.transaction(txid));
  }

  @Get("addresses/:address")
  @Header("Cache-Control", VERIFIED_CACHE)
  async address(
    @Param("address") address: string,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.gateway.execute(() => this.queries.address(address, limit));
  }

  @Get("invalid-events")
  @Header("Cache-Control", VERIFIED_CACHE)
  async invalidEvents(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.gateway.execute(() => this.queries.invalidEvents(limit));
  }

  @Get("mempool")
  @Header("Cache-Control", VERIFIED_CACHE)
  async mempool(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.gateway.execute(() => this.queries.mempool(limit));
  }

  @Get("conflicts")
  @Header("Cache-Control", VERIFIED_CACHE)
  async conflicts(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.gateway.execute(() => this.queries.conflicts(limit));
  }

  @Get("reorgs")
  @Header("Cache-Control", VERIFIED_CACHE)
  async reorgs(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.gateway.execute(() => this.queries.reorgs(limit));
  }

  @Get("stats")
  @Header("Cache-Control", VERIFIED_CACHE)
  async stats() {
    return this.gateway.execute(() => this.queries.stats());
  }

  @Get("search")
  @Header("Cache-Control", VERIFIED_CACHE)
  async search(
    @Query("q") query: string,
    @Query("limit", new DefaultValuePipe(25), ParseIntPipe) limit: number,
  ) {
    return this.gateway.execute(() => this.queries.search(query, limit));
  }
}
