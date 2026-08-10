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
import { VerifiedGatewayService } from "../verification/verified-gateway.service.js";
import { TandemQueryService } from "./tandem-query.service.js";

const VERIFIED_CACHE = "no-store";

const UNAVAILABLE = {
  description:
    "Verification did not hold. Returned when this pipeline is not ready at a canonical height, pipeline B is unreachable or slow, either envelope is malformed, either signing key is untrusted, either signature fails, any of the nine compared fields differ, or the agreement changed between the two checks around the read.",
  schema: { $ref: "#/components/schemas/VerificationUnavailable" },
};

/** Every verified route returns the endpoint data under the same envelope. */
function verifiedResponse(dataDescription: string) {
  return {
    description: `${dataDescription} Wrapped with the agreement both pipelines signed.`,
    schema: {
      type: "object" as const,
      required: ["verification", "data"],
      properties: {
        verification: { $ref: "#/components/schemas/Verification" },
        data: { type: "object" as const, description: dataDescription },
      },
    },
  };
}

const LIMIT_QUERY = {
  name: "limit",
  required: false,
  description: "Row cap between 1 and 200. Anything outside that range is rejected.",
  schema: { type: "integer" as const, minimum: 1, maximum: 200, default: 50 },
};

const TXID_PARAM = {
  name: "txid",
  description: "Transaction id in the usual lowercase display order, 64 hexadecimal characters.",
};

@ApiTags("tandem-verified")
@ApiServiceUnavailableResponse(UNAVAILABLE)
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
  @ApiOperation({
    summary: "Verified deployment and canonical tip",
    description:
      "The same status payload as the direct surface, released only while two independently signed agreement tuples match at the same canonical height.",
  })
  @ApiOkResponse(verifiedResponse("Deployment binding, canonical tip, and mempool count."))
  async status() {
    return this.gateway.execute(() => this.queries.status());
  }

  @Get("objects")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({
    summary: "Verified object listing",
    description: "Objects newest first by creation height, then by object key.",
  })
  @ApiQuery(LIMIT_QUERY)
  @ApiOkResponse(verifiedResponse("A page of objects."))
  async objects(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.gateway.execute(() => this.queries.objects(limit));
  }

  @Get("objects/:key")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({ summary: "Verified object detail with its chapters" })
  @ApiParam({ name: "key", description: "The 32-byte object key as 64 lowercase hex characters." })
  @ApiOkResponse(verifiedResponse("One object and its ordered chapters."))
  @ApiBadRequestResponse({ description: "`object key must be 32-byte hex`." })
  @ApiNotFoundResponse({
    description:
      "`object not found`. A missing row stays a 404 and is not converted into a verification failure.",
  })
  async object(@Param("key") key: string) {
    return this.gateway.execute(() => this.queries.object(key));
  }

  @Get("events/:txid")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({ summary: "Verified canonical events for a transaction" })
  @ApiParam(TXID_PARAM)
  @ApiOkResponse(verifiedResponse("The transaction id and its ordered events."))
  @ApiBadRequestResponse({ description: "`txid must be 32-byte hex`." })
  @ApiNotFoundResponse({ description: "`transaction not found`." })
  async events(@Param("txid") txid: string) {
    return this.gateway.execute(() => this.queries.events(txid));
  }

  @Get("transactions/:txid")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({ summary: "Verified transaction detail and its events" })
  @ApiParam(TXID_PARAM)
  @ApiOkResponse(verifiedResponse("The transaction record and its events."))
  @ApiBadRequestResponse({ description: "`txid must be 32-byte hex`." })
  @ApiNotFoundResponse({ description: "`transaction not found`." })
  async transaction(@Param("txid") txid: string) {
    return this.gateway.execute(() => this.queries.transaction(txid));
  }

  @Get("addresses/:address")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({
    summary: "Verified carrier activity for an address",
    description:
      "Accepts the native SegWit P2WSH address of a carrier. The checksum is validated against the deployment network and the 32-byte witness program is matched against a database-generated projection of the stored keys, so no separately supplied address label is trusted.",
  })
  @ApiParam({
    name: "address",
    description: "Bech32 P2WSH address. The prefix must match the deployment network.",
  })
  @ApiQuery(LIMIT_QUERY)
  @ApiOkResponse(verifiedResponse("Carriers controlled by that address, newest first."))
  @ApiBadRequestResponse({ description: "`address is not a valid carrier P2WSH address`." })
  async address(
    @Param("address") address: string,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.gateway.execute(() => this.queries.address(address, limit));
  }

  @Get("invalid-events")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({ summary: "Verified listing of observations that produced no state" })
  @ApiQuery(LIMIT_QUERY)
  @ApiOkResponse(verifiedResponse("Invalid observations, newest first."))
  async invalidEvents(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.gateway.execute(() => this.queries.invalidEvents(limit));
  }

  @Get("mempool")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({
    summary: "Verified mempool overlay",
    description:
      "Unconfirmed observations kept in their own table. They never contribute to canonical state, counters, or roots.",
  })
  @ApiQuery(LIMIT_QUERY)
  @ApiOkResponse(verifiedResponse("Mempool overlay rows, most recently seen first."))
  async mempool(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.gateway.execute(() => this.queries.mempool(limit));
  }

  @Get("conflicts")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({
    summary: "Verified conflict listing",
    description: "Recorded cases where more than one transaction competed for the same outpoint.",
  })
  @ApiQuery(LIMIT_QUERY)
  @ApiOkResponse(verifiedResponse("Conflicts, newest first."))
  async conflicts(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.gateway.execute(() => this.queries.conflicts(limit));
  }

  @Get("reorgs")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({ summary: "Verified reorganization journal" })
  @ApiQuery(LIMIT_QUERY)
  @ApiOkResponse(verifiedResponse("Completed rollbacks, newest first."))
  async reorgs(@Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.gateway.execute(() => this.queries.reorgs(limit));
  }

  @Get("stats")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({ summary: "Verified aggregate counts" })
  @ApiOkResponse(verifiedResponse("Aggregate counters."))
  async stats() {
    return this.gateway.execute(() => this.queries.stats());
  }

  @Get("search")
  @Header("Cache-Control", VERIFIED_CACHE)
  @ApiOperation({
    summary: "Verified explorer search",
    description:
      "Resolves one query string against objects, transactions, and carrier addresses at once. A 64-character hex value is matched against object keys, creating and terminal transaction ids, txids, and wtxids. A valid carrier address for the deployment network is matched against the generated witness program column.",
  })
  @ApiQuery({
    name: "q",
    required: true,
    description:
      "Between 1 and 128 characters from `A-Z a-z 0-9 : . _ -`. Anything else is rejected before any query runs.",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Row cap between 1 and 200.",
    schema: { type: "integer", minimum: 1, maximum: 200, default: 25 },
  })
  @ApiOkResponse(verifiedResponse("Matching objects, transactions, and carriers."))
  @ApiBadRequestResponse({
    description:
      "`search query must contain between 1 and 128 characters` or `search query contains unsupported characters`.",
  })
  async search(
    @Query("q") query: string,
    @Query("limit", new DefaultValuePipe(25), ParseIntPipe) limit: number,
  ) {
    return this.gateway.execute(() => this.queries.search(query, limit));
  }
}
