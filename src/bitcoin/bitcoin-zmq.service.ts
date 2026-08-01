import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Subscriber } from "zeromq";
import type { AppConfiguration } from "../config/configuration.js";

export interface SequenceNotification {
  hash: string;
  label: string;
  sequence: bigint | null;
}

@Injectable()
export class BitcoinZmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BitcoinZmqService.name);
  private readonly sockets: Subscriber[] = [];
  private stopping = false;

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<AppConfiguration, true>,
    @Inject(EventEmitter2)
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    const bitcoin = this.config.get("bitcoin", { infer: true });
    if (bitcoin.zmqHashBlock) this.subscribe(bitcoin.zmqHashBlock, "hashblock");
    if (bitcoin.zmqRawTx) this.subscribe(bitcoin.zmqRawTx, "rawtx");
    if (bitcoin.zmqSequence) this.subscribe(bitcoin.zmqSequence, "sequence");
  }

  onModuleDestroy(): void {
    this.stopping = true;
    for (const socket of this.sockets) socket.close();
    this.sockets.length = 0;
  }

  private subscribe(endpoint: string, topic: "hashblock" | "rawtx" | "sequence"): void {
    const socket = new Subscriber();
    socket.connect(endpoint);
    socket.subscribe(topic);
    this.sockets.push(socket);
    this.logger.log({ event: "zmq_connected", endpoint, topic });
    void this.consume(socket, topic);
  }

  private async consume(socket: Subscriber, topic: string): Promise<void> {
    try {
      for await (const frames of socket) {
        if (this.stopping) return;
        const body = frames[1];
        if (!body) continue;
        if (topic === "hashblock") {
          this.events.emit("bitcoin.hashblock", Buffer.from(body).reverse().toString("hex"));
        } else if (topic === "rawtx") {
          this.events.emit("bitcoin.rawtx", Buffer.from(body));
        } else {
          this.events.emit("bitcoin.sequence", this.parseSequence(Buffer.from(body)));
        }
      }
    } catch (error) {
      if (!this.stopping) {
        this.logger.error({
          event: "zmq_error",
          topic,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private parseSequence(body: Buffer): SequenceNotification {
    return {
      hash: body.length >= 32 ? body.subarray(0, 32).reverse().toString("hex") : "",
      label: body.length >= 33 ? String.fromCharCode(body[32] ?? 0) : "",
      sequence: body.length >= 41 ? body.readBigUInt64LE(33) : null,
    };
  }
}
