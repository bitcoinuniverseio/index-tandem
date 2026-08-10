/**
 * Writes the OpenAPI document to disk so the documentation site can render an
 * API reference that cannot drift from the service.
 *
 * The document is produced from the real controllers. The only substitutions
 * are a stub DataSource and a Bitcoin Core client that always fails, because
 * neither MySQL nor a node is needed to describe routes. Nothing here listens
 * on a port or opens a connection.
 */
import "reflect-metadata";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import { DataSource } from "typeorm";
import { ApiModule } from "../src/api/api.module.js";
import { buildOpenApiConfig, withExtraSchemas } from "../src/api/openapi.js";
import { BitcoinModule } from "../src/bitcoin/bitcoin.module.js";
import { loadConfiguration } from "../src/config/configuration.js";
import { IndexerModule } from "../src/indexer/indexer.module.js";
import { ObservabilityModule } from "../src/observability/observability.module.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../site/src/data/openapi.json");

/**
 * A description-time environment. These are not launch parameters; they only
 * have to satisfy the configuration validator so the module graph resolves.
 */
function describeEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    TANDEM_NETWORK: "signet",
    TANDEM_INIT_TXID: "11".repeat(32),
    TANDEM_INIT_HEIGHT: "1008",
    TANDEM_OPEN_HEIGHT: "2016",
    TANDEM_CLOSE_HEIGHT: "6336",
    TANDEM_SPEC_HASH: "22".repeat(32),
    TANDEM_NAMESPACE: "",
    BITCOIN_RPC_URL: "http://127.0.0.1:38332",
    BITCOIN_RPC_USER: "openapi",
    BITCOIN_RPC_PASSWORD: "openapi",
    MYSQL_HOST: "127.0.0.1",
    MYSQL_USER: "tandem",
    MYSQL_PASSWORD: "openapi",
    MYSQL_DATABASE: "tandem_openapi",
  };
}

const stubDataSource = {
  query: async () => [],
  getRepository: () => ({}),
  transaction: async () => undefined,
  createQueryBuilder: () => ({}),
};

@Global()
@Module({
  providers: [{ provide: DataSource, useValue: stubDataSource }],
  exports: [DataSource],
})
class StubDatabaseModule {}

async function environmentWithNamespace(): Promise<NodeJS.ProcessEnv> {
  const { bytesToHex, hexToBytes, NETWORK, namespaceCommitment } = await import(
    "@bitcoinuniverse/tandem"
  );
  const env = describeEnvironment();
  env.TANDEM_NAMESPACE = bytesToHex(
    namespaceCommitment(
      NETWORK.signet,
      hexToBytes(env.TANDEM_INIT_TXID as string, 32),
      hexToBytes(env.TANDEM_SPEC_HASH as string, 32),
    ),
  );
  return env;
}

async function main(): Promise<void> {
  const env = await environmentWithNamespace();

  @Module({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => loadConfiguration(env)] }),
      StubDatabaseModule,
      BitcoinModule,
      IndexerModule,
      ObservabilityModule,
      ApiModule,
    ],
  })
  class OpenApiModule {}

  const app = await NestFactory.create(OpenApiModule, { logger: false, abortOnError: false });
  const document = withExtraSchemas(SwaggerModule.createDocument(app, buildOpenApiConfig()));
  await app.close();

  const routes = Object.values(document.paths ?? {}).reduce(
    (total, item) => total + Object.keys(item as Record<string, unknown>).length,
    0,
  );

  await writeFile(OUT, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  process.stdout.write(`openapi: ${routes} operations written to site/src/data/openapi.json\n`);
}

await main();
