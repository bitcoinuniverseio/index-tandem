import { DataSource } from "typeorm";
import type { AppConfiguration } from "../config/configuration.js";
import { ENTITIES } from "./entities.js";
import { InitTandemV1Schema1800000000000 } from "./migrations/1800000000000-init-tandem-v1.js";

export function createDataSource(configuration: AppConfiguration): DataSource {
  return new DataSource({
    type: "mysql",
    host: configuration.database.host,
    port: configuration.database.port,
    username: configuration.database.username,
    password: configuration.database.password,
    database: configuration.database.database,
    charset: "utf8mb4_bin",
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true,
    synchronize: false,
    entities: [...ENTITIES],
    migrations: [InitTandemV1Schema1800000000000],
    migrationsTableName: "tandem_migrations",
  });
}
