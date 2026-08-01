import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { describe, expect, it } from "vitest";
import { AgreementSignerService } from "../src/agreement/agreement.service.js";
import { BitcoinRpcClient } from "../src/bitcoin/bitcoin-rpc.client.js";
import { ReadinessService } from "../src/observability/readiness.service.js";
import { TandemProtocolService } from "../src/protocol/protocol.service.js";

const SELF_DECLARED_DEPS_METADATA = "self:paramtypes";

function dependencies(target: object): Array<{ index: number; param: unknown }> {
  const declared = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target) as Array<{
    index: number;
    param: unknown;
  }>;
  return [...declared].sort((left, right) => left.index - right.index);
}

describe("Nest dependency metadata", () => {
  it("declares explicit runtime tokens for every critical dependency", () => {
    expect(dependencies(TandemProtocolService)).toEqual([{ index: 0, param: ConfigService }]);
    expect(dependencies(AgreementSignerService)).toEqual([{ index: 0, param: ConfigService }]);
    expect(dependencies(ReadinessService)).toEqual([
      { index: 0, param: DataSource },
      { index: 1, param: BitcoinRpcClient },
      { index: 2, param: ConfigService },
      { index: 3, param: AgreementSignerService },
    ]);
  });
});
