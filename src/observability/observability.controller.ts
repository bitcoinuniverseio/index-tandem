import { Controller, Get, Header, Inject, ServiceUnavailableException } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { MetricsService } from "./metrics.service.js";
import { ReadinessService } from "./readiness.service.js";

@ApiTags("operations")
@Controller()
export class ObservabilityController {
  constructor(
    @Inject(ReadinessService)
    private readonly readiness: ReadinessService,
    @Inject(MetricsService)
    private readonly metrics: MetricsService,
  ) {}

  @Get("health")
  @ApiOperation({
    summary: "Process liveness only",
    description:
      "Answers as long as the process is running. It says nothing about dependencies, canonical state, or agreement. The container health check probes this endpoint, so a container can report healthy while `/ready` is refusing traffic. Gate traffic on `/ready`.",
  })
  @ApiOkResponse({
    description: "The process is up.",
    schema: {
      type: "object",
      properties: {
        ok: { type: "boolean", enum: [true] },
        service: { type: "string", enum: ["index-tandem-a"] },
        uptimeSeconds: { type: "integer" },
      },
    },
  })
  health() {
    return { ok: true, service: "index-tandem-a", uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Get("ready")
  @ApiOperation({
    summary: "Fail-closed dependency and canonical-state readiness",
    description:
      "Evaluates ten gates and reports every one that failed. Readiness requires valid configuration, a reachable database, a reachable Bitcoin Core on the expected chain that is out of initial block download, a known node height, a canonical tip within the configured lag, a checkpoint at exactly that tip, and a configured signing boundary. Reading this endpoint also refreshes the Prometheus gauges.",
  })
  @ApiOkResponse({ description: "Every gate passed." })
  @ApiServiceUnavailableResponse({
    description:
      "At least one gate failed. The body is the full snapshot and `reasons` names each failure.",
    schema: {
      type: "object",
      properties: {
        ready: { type: "boolean", enum: [false] },
        reasons: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "configuration_invalid",
              "database_unavailable",
              "bitcoin_core_unavailable",
              "bitcoin_network_mismatch",
              "bitcoin_core_initial_block_download",
              "node_height_unknown",
              "canonical_tip_missing",
              "canonical_tip_stale",
              "checkpoint_incomplete",
              "agreement_signer_unavailable",
            ],
          },
        },
      },
    },
  })
  async ready() {
    const snapshot = await this.readiness.probe();
    this.metrics.ready.set(snapshot.ready ? 1 : 0);
    if (snapshot.canonicalHeight !== null)
      this.metrics.canonicalHeight.set(snapshot.canonicalHeight);
    if (!snapshot.ready) throw new ServiceUnavailableException(snapshot);
    return snapshot;
  }

  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  @ApiOperation({
    summary: "Prometheus text exposition",
    description:
      "Default Node process metrics under the `tandem_indexer_` prefix, plus `tandem_indexer_ready` and `tandem_indexer_canonical_height`. Those two gauges are refreshed by a request to `/ready`, so scrape readiness as well as metrics.",
  })
  @ApiProduces("text/plain")
  @ApiOkResponse({ description: "Prometheus exposition format." })
  metricsText(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
