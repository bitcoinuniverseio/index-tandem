import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { buildOpenApiConfig, withExtraSchemas } from "./api/openapi.js";
import { AppModule } from "./app.module.js";
import type { AppConfiguration } from "./config/configuration.js";

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.use(helmet());
app.enableShutdownHooks();
const document = withExtraSchemas(SwaggerModule.createDocument(app, buildOpenApiConfig()));
SwaggerModule.setup("docs", app, document, {
  jsonDocumentUrl: "docs-json",
  swaggerOptions: { docExpansion: "list", defaultModelsExpandDepth: 2 },
});
const config = app.get<ConfigService<AppConfiguration, true>>(ConfigService);
const service = config.get("service", { infer: true });
await app.listen(service.port, service.host);
