import {
  bytesToHex,
  hexToBytes,
  isTandemMarkerCandidate,
  type Marker,
  parseMarkerScript,
  REASON,
  type ReasonCode,
} from "@bitcoinuniverse/tandem";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfiguration } from "../config/configuration.js";
import type { BitcoinTransaction } from "./bitcoin.js";

export type ProtocolObservation =
  | { classification: "none" }
  | { classification: "invalid"; reason: ReasonCode; markerOutput: number | null }
  | { classification: "candidate"; marker: Marker; markerOutput: number; payloadHex: string };

@Injectable()
export class TandemProtocolService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<AppConfiguration, true>,
  ) {}

  inspectTransaction(transaction: BitcoinTransaction): ProtocolObservation {
    const deployment = this.config.get("deployment", { infer: true });
    const candidates = transaction.outputs
      .map((output) => ({ output, script: hexToBytes(output.scriptPubKeyHex) }))
      .filter(({ script }) => isTandemMarkerCandidate(script));
    if (candidates.length === 0) return { classification: "none" };
    if (candidates.length !== 1) {
      return { classification: "invalid", reason: REASON.MULTIPLE_MARKERS, markerOutput: null };
    }
    const candidate = candidates[0];
    if (!candidate) throw new Error("unreachable candidate");
    const result = parseMarkerScript(candidate.script, deployment.networkCode);
    if (!result.ok) {
      return {
        classification: "invalid",
        reason: result.reason,
        markerOutput: candidate.output.n,
      };
    }
    if (result.marker.operation === "INIT") {
      if (transaction.txid !== deployment.initTxid) {
        return {
          classification: "invalid",
          reason: REASON.WRONG_NAMESPACE,
          markerOutput: candidate.output.n,
        };
      }
      if (
        result.marker.openHeight !== deployment.openHeight ||
        result.marker.closeHeight !== deployment.closeHeight
      ) {
        return {
          classification: "invalid",
          reason: REASON.BAD_HEIGHT_OR_PHASE,
          markerOutput: candidate.output.n,
        };
      }
      if (bytesToHex(result.marker.specHash) !== deployment.specHash) {
        return {
          classification: "invalid",
          reason: REASON.WRONG_NAMESPACE,
          markerOutput: candidate.output.n,
        };
      }
    } else if (bytesToHex(result.marker.namespace) !== deployment.namespace) {
      return {
        classification: "invalid",
        reason: REASON.WRONG_NAMESPACE,
        markerOutput: candidate.output.n,
      };
    }
    return {
      classification: "candidate",
      marker: result.marker,
      markerOutput: candidate.output.n,
      payloadHex: bytesToHex(result.payload),
    };
  }
}
