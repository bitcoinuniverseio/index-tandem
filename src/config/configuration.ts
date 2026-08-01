import {
  FOUNDING_WINDOW,
  hexToBytes,
  INIT_LEAD,
  NETWORK,
  type NetworkCode,
  type NetworkName,
  namespaceCommitment,
} from "@bitcoinuniverse/tandem";

const HASH_HEX = /^[0-9a-f]{64}$/;
const PRIVATE_KEY_HEX = /^[0-9a-f]{64}$/;
const PUBLIC_KEY_HEX = /^[0-9a-f]{64}$/;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export interface DeploymentConfiguration {
  protocolId: string;
  network: NetworkName;
  networkCode: NetworkCode;
  initTxid: string;
  initHeight: number;
  openHeight: number;
  closeHeight: number;
  specHash: string;
  namespace: string;
}

export interface AppConfiguration {
  service: { port: number; environment: string };
  deployment: DeploymentConfiguration;
  bitcoin: {
    rpcUrl: string;
    rpcUser: string;
    rpcPassword: string;
    rpcTimeoutMs: number;
    expectedChain: "main" | "signet" | "testnet4" | "regtest";
    zmqHashBlock?: string;
    zmqRawTx?: string;
    zmqSequence?: string;
  };
  database: { host: string; port: number; username: string; password: string; database: string };
  readiness: { maxBlockLag: number };
  agreement: { keyId?: string; privateKeyHex?: string; publicKeyHex?: string };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new ConfigurationError(`${key} is required`);
  return value;
}

function optional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback?: number): number {
  const source = env[key]?.trim();
  if (!source && fallback !== undefined) return fallback;
  if (!source || !/^\d+$/.test(source)) throw new ConfigurationError(`${key} must be an integer`);
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ConfigurationError(`${key} must be a nonnegative safe integer`);
  }
  return value;
}

function hash(env: NodeJS.ProcessEnv, key: string): string {
  const value = required(env, key).toLowerCase();
  if (!HASH_HEX.test(value)) throw new ConfigurationError(`${key} must be 32-byte lowercase hex`);
  return value;
}

function parseNetwork(value: string): NetworkName {
  if (!(value in NETWORK)) throw new ConfigurationError(`unsupported TANDEM_NETWORK: ${value}`);
  return value as NetworkName;
}

function expectedChain(network: NetworkName): AppConfiguration["bitcoin"]["expectedChain"] {
  return network === "mainnet" ? "main" : network;
}

export function loadConfiguration(env: NodeJS.ProcessEnv): AppConfiguration {
  const network = parseNetwork(required(env, "TANDEM_NETWORK"));
  const networkCode = NETWORK[network];
  const initTxid = hash(env, "TANDEM_INIT_TXID");
  const initHeight = integer(env, "TANDEM_INIT_HEIGHT");
  const openHeight = integer(env, "TANDEM_OPEN_HEIGHT");
  const closeHeight = integer(env, "TANDEM_CLOSE_HEIGHT");
  const specHash = hash(env, "TANDEM_SPEC_HASH");
  const namespace = hash(env, "TANDEM_NAMESPACE");
  if (closeHeight !== openHeight + FOUNDING_WINDOW) {
    throw new ConfigurationError(
      `TANDEM_CLOSE_HEIGHT must equal open height plus ${FOUNDING_WINDOW}`,
    );
  }
  if (openHeight - initHeight < INIT_LEAD) {
    throw new ConfigurationError(
      `TANDEM_INIT_HEIGHT must precede the open height by at least ${INIT_LEAD} blocks`,
    );
  }
  const derivedNamespace = Buffer.from(
    namespaceCommitment(networkCode, hexToBytes(initTxid, 32), hexToBytes(specHash, 32)),
  ).toString("hex");
  if (namespace !== derivedNamespace) {
    throw new ConfigurationError("TANDEM_NAMESPACE does not match the configured INIT tuple");
  }
  const privateKeyHex = optional(env, "AGREEMENT_PRIVATE_KEY_HEX")?.toLowerCase();
  const publicKeyHex = optional(env, "AGREEMENT_PUBLIC_KEY_HEX")?.toLowerCase();
  if (privateKeyHex && !PRIVATE_KEY_HEX.test(privateKeyHex)) {
    throw new ConfigurationError("AGREEMENT_PRIVATE_KEY_HEX must be a 32-byte key");
  }
  if (publicKeyHex && !PUBLIC_KEY_HEX.test(publicKeyHex)) {
    throw new ConfigurationError("AGREEMENT_PUBLIC_KEY_HEX must be a 32-byte key");
  }
  const keyId = optional(env, "AGREEMENT_KEY_ID");
  if ((privateKeyHex || publicKeyHex) && !keyId) {
    throw new ConfigurationError(
      "AGREEMENT_KEY_ID is required when an agreement key is configured",
    );
  }
  const protocolId = `tndm:v1:${network}:${initTxid}`;
  const zmqHashBlock = optional(env, "BITCOIN_ZMQ_HASHBLOCK");
  const zmqRawTx = optional(env, "BITCOIN_ZMQ_RAWTX");
  const zmqSequence = optional(env, "BITCOIN_ZMQ_SEQUENCE");
  return {
    service: {
      port: integer(env, "PORT", 3021),
      environment: env.NODE_ENV?.trim() || "development",
    },
    deployment: {
      protocolId,
      network,
      networkCode,
      initTxid,
      initHeight,
      openHeight,
      closeHeight,
      specHash,
      namespace,
    },
    bitcoin: {
      rpcUrl: required(env, "BITCOIN_RPC_URL"),
      rpcUser: required(env, "BITCOIN_RPC_USER"),
      rpcPassword: required(env, "BITCOIN_RPC_PASSWORD"),
      rpcTimeoutMs: integer(env, "BITCOIN_RPC_TIMEOUT_MS", 15_000),
      expectedChain: expectedChain(network),
      ...(zmqHashBlock ? { zmqHashBlock } : {}),
      ...(zmqRawTx ? { zmqRawTx } : {}),
      ...(zmqSequence ? { zmqSequence } : {}),
    },
    database: {
      host: required(env, "MYSQL_HOST"),
      port: integer(env, "MYSQL_PORT", 3306),
      username: required(env, "MYSQL_USER"),
      password: required(env, "MYSQL_PASSWORD"),
      database: required(env, "MYSQL_DATABASE"),
    },
    readiness: { maxBlockLag: integer(env, "READINESS_MAX_BLOCK_LAG", 2) },
    agreement: {
      ...(keyId ? { keyId } : {}),
      ...(privateKeyHex ? { privateKeyHex } : {}),
      ...(publicKeyHex ? { publicKeyHex } : {}),
    },
  };
}
