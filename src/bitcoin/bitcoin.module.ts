import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { BitcoinRpcClient } from "./bitcoin-rpc.client.js";
import { BitcoinZmqService } from "./bitcoin-zmq.service.js";

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [BitcoinRpcClient, BitcoinZmqService],
  exports: [BitcoinRpcClient],
})
export class BitcoinModule {}
