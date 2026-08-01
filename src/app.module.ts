import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApiModule } from "./api/api.module.js";
import { BitcoinModule } from "./bitcoin/bitcoin.module.js";
import { type AppConfiguration, loadConfiguration } from "./config/configuration.js";
import { ENTITIES } from "./database/entities.js";
import { InitTandemV1Schema1800000000000 } from "./database/migrations/1800000000000-init-tandem-v1.js";
import { AddCarrierProgram1800000001000 } from "./database/migrations/1800000001000-add-carrier-program.js";
import { IndexerModule } from "./indexer/indexer.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [() => loadConfiguration(process.env)],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfiguration, true>) => {
        const database = config.get("database", { infer: true });
        return {
          type: "mysql" as const,
          ...database,
          charset: "utf8mb4_bin",
          timezone: "Z",
          supportBigNumbers: true,
          bigNumberStrings: true,
          synchronize: false,
          migrationsRun: false,
          entities: [...ENTITIES],
          migrations: [InitTandemV1Schema1800000000000, AddCarrierProgram1800000001000],
          migrationsTableName: "tandem_migrations",
        };
      },
    }),
    BitcoinModule,
    IndexerModule,
    ObservabilityModule,
    ApiModule,
  ],
})
export class AppModule {}
