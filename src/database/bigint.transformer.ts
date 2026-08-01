import type { ValueTransformer } from "typeorm";

export const bigintTransformer: ValueTransformer = {
  to(value: bigint | number | string | null): string | null {
    return value === null ? null : String(value);
  },
  from(value: string | null): bigint | null {
    return value === null ? null : BigInt(value);
  },
};
