import "reflect-metadata";
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiModule } from "../src/api/api.module.js";
import { BitcoinModule } from "../src/bitcoin/bitcoin.module.js";
import { BitcoinRpcClient } from "../src/bitcoin/bitcoin-rpc.client.js";
import { loadConfiguration } from "../src/config/configuration.js";
import { IndexerModule } from "../src/indexer/indexer.module.js";
import { ObservabilityController } from "../src/observability/observability.controller.js";
import { ObservabilityModule } from "../src/observability/observability.module.js";
import { ReadinessService } from "../src/observability/readiness.service.js";
import { validEnvironment } from "./fixtures.js";

const database = {
  query: vi.fn(async (statement: string) => {
    if (statement === "SELECT 1") return [{ ok: 1 }];
    return [];
  }),
  getRepository: vi.fn(),
  transaction: vi.fn(),
  createQueryBuilder: vi.fn(),
};

@Global()
@Module({ providers: [{ provide: DataSource, useValue: database }], exports: [DataSource] })
class SmokeDatabaseModule {}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => loadConfiguration(validEnvironment())],
    }),
    SmokeDatabaseModule,
    BitcoinModule,
    IndexerModule,
    ObservabilityModule,
    ApiModule,
  ],
})
class SmokeAppModule {}

describe("application bootstrap", () => {
  let closeApplication: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await closeApplication?.();
    closeApplication = undefined;
    vi.clearAllMocks();
  });

  it("initializes the real feature graph and remains not ready without external evidence", async () => {
    const testingModule = await Test.createTestingModule({ imports: [SmokeAppModule] })
      .overrideProvider(BitcoinRpcClient)
      .useValue({
        getBlockchainInfo: vi.fn().mockRejectedValue(new Error("Bitcoin Core not connected")),
      })
      .compile();
    const application = testingModule.createNestApplication();
    closeApplication = () => application.close();
    await application.init();

    expect(application.get(ObservabilityController).health()).toMatchObject({
      ok: true,
      service: "index-tandem-a",
    });
    await expect(application.get(ReadinessService).probe()).resolves.toMatchObject({
      ready: false,
      coreAvailable: false,
      canonicalHeight: null,
      checkpointHeight: null,
      signerConfigured: false,
    });
  }, 30_000);
});
