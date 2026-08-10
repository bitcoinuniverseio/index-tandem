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
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AgreementQueryService } from "../agreement/agreement-query.service.js";
import { ReadinessService } from "../observability/readiness.service.js";
import { TandemQueryService } from "./tandem-query.service.js";

const PUBLIC_CACHE = "public, max-age=10, stale-while-revalidate=30";

const TXID_PARAM = {
  name: "txid",
  description: "Transaction id in the usual lowercase display order, 64 hexadecimal characters.",
  example: "9d2f0c1a4b6e8d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f",
};

const LIMIT_QUERY = {
  name: "limit",
  required: false,
  description: "Row cap between 1 and 200. Anything outside that range is rejected.",
  schema: { type: "integer" as const, minimum: 1, maximum: 200, default: 50 },
};

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
  @ApiOperation({
    summary: "Bound deployment and canonical tip",
    description:
      "Returns the immutable deployment binding, the highest canonical block this pipeline has recorded, and the mempool overlay row count. `canonicalTip` is null until a block has been recorded.",
  })
  @ApiOkResponse({ description: "Deployment binding, canonical tip, and mempool count." })
  status() {
    return this.queries.status();
  }

  @Get("readiness")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Readiness snapshot with the reasons behind it",
    description:
      "Same evaluation as `GET /ready`, returned under the protocol prefix. Every failing gate is listed in `reasons`.",
  })
  @ApiOkResponse({ description: "Every readiness gate passed." })
  @ApiServiceUnavailableResponse({
    description: "At least one gate failed. The body is the full snapshot including `reasons`.",
  })
  async readinessSnapshot() {
    const snapshot = await this.readiness.probe();
    if (!snapshot.ready) throw new ServiceUnavailableException(snapshot);
    return snapshot;
  }

  @Get("objects/:objectKey")
  @Header("Cache-Control", PUBLIC_CACHE)
  @ApiOperation({
    summary: "One object and its chapters",
    description:
      "Looks up an object by its 32-byte binary key and returns its current state together with every chapter in sequence order.",
  })
  @ApiParam({
    name: "objectKey",
    description: "The 32-byte object key as 64 lowercase hexadecimal characters.",
  })
  @ApiOkResponse({ description: "The object and its ordered chapters." })
  @ApiBadRequestResponse({ description: "`object key must be 32-byte hex`." })
  @ApiNotFoundResponse({ description: "`object not found`." })
  object(@Param("objectKey") objectKey: string) {
    return this.queries.object(objectKey);
  }

  @Get("carriers/:txid/:vout")
  @Header("Cache-Control", PUBLIC_CACHE)
  @ApiOperation({
    summary: "Carrier state at an exact outpoint",
    description:
      "Returns the carrier record for one outpoint, including the height that created it and the transaction that spent it if it is no longer current.",
  })
  @ApiParam(TXID_PARAM)
  @ApiParam({ name: "vout", description: "Output index. A carrier is always output index 1." })
  @ApiOkResponse({ description: "The carrier record." })
  @ApiBadRequestResponse({ description: "`txid must be 32-byte hex` or `vout is invalid`." })
  @ApiNotFoundResponse({ description: "`carrier not found`." })
  carrier(@Param("txid") txid: string, @Param("vout", ParseIntPipe) vout: number) {
    return this.queries.carrier(txid, vout);
  }

  @Get("events/:txid")
  @Header("Cache-Control", PUBLIC_CACHE)
  @ApiOperation({
    summary: "Canonical events for one transaction",
    description:
      "Returns every event this transaction produced, ordered by event index. A known transaction that produced no event returns an empty list rather than a 404.",
  })
  @ApiParam(TXID_PARAM)
  @ApiOkResponse({ description: "The transaction id and its ordered events." })
  @ApiBadRequestResponse({ description: "`txid must be 32-byte hex`." })
  @ApiNotFoundResponse({ description: "`transaction not found`." })
  events(@Param("txid") txid: string) {
    return this.queries.events(txid);
  }

  @Get("invalid-events")
  @Header("Cache-Control", PUBLIC_CACHE)
  @ApiOperation({
    summary: "Observations that produced no state",
    description:
      "Validity class 0 events, newest first. These record a rejected observation and its reason code without mutating any object.",
  })
  @ApiQuery(LIMIT_QUERY)
  @ApiOkResponse({ description: "Invalid observations, newest first." })
  invalidEvents(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.queries.invalidEvents(limit);
  }

  @Get("reorgs")
  @Header("Cache-Control", PUBLIC_CACHE)
  @ApiOperation({
    summary: "Reorganization journal",
    description:
      "One row per completed rollback, newest first, recording the old tip, the common ancestor, the new tip, and how many blocks were rolled back.",
  })
  @ApiQuery(LIMIT_QUERY)
  @ApiOkResponse({ description: "Completed rollbacks, newest first." })
  reorgs(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.queries.reorgs(limit);
  }

  @Get("stats")
  @Header("Cache-Control", PUBLIC_CACHE)
  @ApiOperation({
    summary: "Aggregate counts",
    description:
      "Object, chapter, invalid event, and unresolved conflict counts computed directly from canonical tables.",
  })
  @ApiOkResponse({ description: "Aggregate counters." })
  stats() {
    return this.queries.stats();
  }

  @Get("agreement/:height")
  @Header("Cache-Control", "public, max-age=60, immutable")
  @ApiOperation({
    summary: "This pipeline's signed agreement tuple at a height",
    description:
      "Returns the Ed25519 envelope over the RFC 8785 canonical JSON of the tuple for one canonical height. This is the endpoint an independent pipeline calls to obtain a second opinion, and the same shape this pipeline expects from pipeline B.",
  })
  @ApiParam({ name: "height", description: "Canonical block height.", example: 1008 })
  @ApiOkResponse({
    description: "The signed agreement envelope.",
    schema: { $ref: "#/components/schemas/AgreementEnvelope" },
  })
  agreement(@Param("height", ParseIntPipe) height: number) {
    return this.agreements.signedAt(height);
  }
}
