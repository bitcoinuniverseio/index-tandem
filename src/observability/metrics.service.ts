import { Injectable } from "@nestjs/common";
import { collectDefaultMetrics, Gauge, Registry } from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly ready = new Gauge({
    name: "tandem_indexer_ready",
    help: "One only when every readiness gate passes",
    registers: [this.registry],
  });
  readonly canonicalHeight = new Gauge({
    name: "tandem_indexer_canonical_height",
    help: "Current canonical Tandem index height",
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: "tandem_indexer_" });
  }
}
