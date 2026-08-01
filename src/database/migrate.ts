import "reflect-metadata";
import { loadConfiguration } from "../config/configuration.js";
import { createDataSource } from "./data-source.js";

const dataSource = createDataSource(loadConfiguration(process.env));
await dataSource.initialize();
try {
  await dataSource.runMigrations({ transaction: "all" });
} finally {
  await dataSource.destroy();
}
