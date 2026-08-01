import { bytesToHex, hexToBytes, NETWORK, namespaceCommitment } from "@bitcoinuniverse/tandem";

export function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const initTxid = "11".repeat(32);
  const specHash = "22".repeat(32);
  const namespace = bytesToHex(
    namespaceCommitment(NETWORK.regtest, hexToBytes(initTxid), hexToBytes(specHash)),
  );
  return {
    NODE_ENV: "test",
    PORT: "3021",
    TANDEM_NETWORK: "regtest",
    TANDEM_INIT_TXID: initTxid,
    TANDEM_INIT_HEIGHT: "1008",
    TANDEM_OPEN_HEIGHT: "2016",
    TANDEM_CLOSE_HEIGHT: "6336",
    TANDEM_SPEC_HASH: specHash,
    TANDEM_NAMESPACE: namespace,
    BITCOIN_RPC_URL: "http://127.0.0.1:18443",
    BITCOIN_RPC_USER: "test-user",
    BITCOIN_RPC_PASSWORD: "test-password",
    MYSQL_HOST: "127.0.0.1",
    MYSQL_USER: "tandem",
    MYSQL_PASSWORD: "test-password",
    MYSQL_DATABASE: "tandem_test",
    ...overrides,
  };
}
