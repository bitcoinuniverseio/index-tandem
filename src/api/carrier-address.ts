import type { NetworkName } from "@bitcoinuniverse/tandem";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const CHARSET_INDEX = new Map([...CHARSET].map((character, index) => [character, index]));
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const PROGRAM_HEX = /^[0-9a-f]{64}$/;

export interface CarrierAddress {
  address: string;
  witnessProgramHex: string;
}

function networkHrp(network: NetworkName): string {
  if (network === "mainnet") return "bc";
  if (network === "regtest") return "bcrt";
  return "tb";
}

function polymod(values: readonly number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    for (let index = 0; index < GENERATORS.length; index += 1) {
      if (((top >>> index) & 1) !== 0) checksum = (checksum ^ (GENERATORS[index] ?? 0)) >>> 0;
    }
  }
  return checksum;
}

function hrpExpand(hrp: string): number[] {
  return [
    ...[...hrp].map((character) => character.charCodeAt(0) >>> 5),
    0,
    ...[...hrp].map((character) => character.charCodeAt(0) & 31),
  ];
}

function convertBits(
  values: readonly number[],
  fromBits: number,
  toBits: number,
  pad: boolean,
): number[] | null {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  const outputMask = (1 << toBits) - 1;
  const maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of values) {
    if (value < 0 || value >>> fromBits !== 0) return null;
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >>> bits) & outputMask);
    }
  }
  if (pad) {
    if (bits > 0) result.push((accumulator << (toBits - bits)) & outputMask);
  } else if (bits >= fromBits || ((accumulator << (toBits - bits)) & outputMask) !== 0) {
    return null;
  }
  return result;
}

export function decodeCarrierAddress(value: string, network: NetworkName): CarrierAddress | null {
  if (typeof value !== "string" || value.length < 14 || value.length > 90) return null;
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return null;
  const address = value.toLowerCase();
  const separator = address.lastIndexOf("1");
  if (separator < 1 || separator + 7 > address.length) return null;
  const hrp = address.slice(0, separator);
  if (hrp !== networkHrp(network)) return null;
  const data: number[] = [];
  for (const character of address.slice(separator + 1)) {
    const index = CHARSET_INDEX.get(character);
    if (index === undefined) return null;
    data.push(index);
  }
  if (polymod([...hrpExpand(hrp), ...data]) !== 1) return null;
  const payload = data.slice(0, -6);
  if (payload[0] !== 0) return null;
  const program = convertBits(payload.slice(1), 5, 8, false);
  if (!program || program.length !== 32) return null;
  return { address, witnessProgramHex: Buffer.from(program).toString("hex") };
}

export function encodeCarrierAddress(witnessProgramHex: string, network: NetworkName): string {
  if (!PROGRAM_HEX.test(witnessProgramHex)) {
    throw new TypeError("carrier witness program must be 32-byte lowercase hex");
  }
  const hrp = networkHrp(network);
  const program = [...Buffer.from(witnessProgramHex, "hex")];
  const converted = convertBits(program, 8, 5, true);
  if (!converted) throw new TypeError("carrier witness program cannot be encoded");
  const data = [0, ...converted];
  const checksumInput = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const residue = polymod(checksumInput) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, index) => (residue >>> (5 * (5 - index))) & 31);
  return `${hrp}1${[...data, ...checksum].map((value) => CHARSET[value]).join("")}`;
}
