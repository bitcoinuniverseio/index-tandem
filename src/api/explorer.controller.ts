import { Controller, Get, Header, Inject, Param, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { BlockEventsService } from "./block-events.service.js";

const NOT_READY = {
  description: "The indexer is not ready. Same rule and body as `GET /tandem/readiness`.",
};

/** Cross-indexer explorer surface (`universe-block-events-v1`), served at the server root. */
@ApiTags("tandem")
@Controller("v1")
export class ExplorerController {
  constructor(
    @Inject(BlockEventsService)
    private readonly blockEvents: BlockEventsService,
  ) {}

  @Get("checkpoint")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Current checkpoint",
    description:
      "Height and block hash of the highest checkpoint this pipeline has recorded. Heights are decimal strings.",
  })
  @ApiOkResponse({ description: "The checkpoint height and block hash." })
  @ApiServiceUnavailableResponse(NOT_READY)
  checkpoint() {
    return this.blockEvents.checkpoint();
  }

  @Get("explorer/blocks/:height/events")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Applied canonical events in one block",
    description:
      "Implements `universe-block-events-v1`. Returns valid operations and terminal exits recorded on the canonical chain at one height, ordered by transaction index, event index, and sub index. Invalid observations are never returned. `indexed` is false when the checkpoint is below the height.",
  })
  @ApiParam({ name: "height", description: "Unsigned decimal block height, at most 10 digits." })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 500, default: 200 },
  })
  @ApiQuery({
    name: "cursor",
    required: false,
    description: "Opaque `nextCursor` from the previous page.",
  })
  @ApiOkResponse({ description: "One page of the block's applied events." })
  @ApiBadRequestResponse({ description: "Malformed height, limit, or cursor." })
  @ApiServiceUnavailableResponse(NOT_READY)
  events(
    @Param("height") height: string,
    @Query("limit") limit: unknown,
    @Query("cursor") cursor: unknown,
  ) {
    return this.blockEvents.blockEvents(height, limit, cursor);
  }
}
