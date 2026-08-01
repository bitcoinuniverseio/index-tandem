import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import type { AppConfiguration } from "./config/configuration.js";

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.use(helmet());
app.enableShutdownHooks();
const swagger = new DocumentBuilder()
  .setTitle("Tandem indexer pipeline A")
  .setDescription("Canonical Tandem v1 indexing and agreement API")
  .setVersion("0.1.0")
  .build();
SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, swagger));
const config = app.get<ConfigService<AppConfiguration, true>>(ConfigService);
await app.listen(config.get("service", { infer: true }).port, "127.0.0.1");
