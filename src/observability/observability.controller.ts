import { Controller, Get, Header, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
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
  @ApiOperation({ summary: "Process liveness only" })
  health() {
    return { ok: true, service: "index-tandem-a", uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Get("ready")
  @ApiOperation({ summary: "Fail-closed dependency and canonical-state readiness" })
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
  metricsText(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
