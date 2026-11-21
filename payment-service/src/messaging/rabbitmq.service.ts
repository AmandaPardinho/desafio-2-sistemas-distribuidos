import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnectionManager, ChannelWrapper, connect } from 'amqp-connection-manager';
import type { Channel, ConsumeMessage } from 'amqplib';
import { setTimeout as sleep } from 'node:timers/promises';
import { EnvironmentVariables } from '../config/env';
import { PAYMENTS_EXCHANGE, assertPaymentTopology } from './topology';

export type ConsumeResult = 'ack' | 'reject';
export type MessageHandler = (message: ConsumeMessage) => Promise<ConsumeResult>;

export interface PublishMetadata {
  messageId: string;
  type: string;
  correlationId?: string;
}

type Settlement = ConsumeResult | 'retry';

interface ActiveConsumer {
  channel: Channel;
  consumerTag: string;
}

const PUBLISH_TIMEOUT_MS = 5000;
const DRAIN_TIMEOUT_MS = 10_000;

@Injectable()
export class RabbitMqService
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(RabbitMqService.name);
  private readonly inFlight = new Set<Promise<void>>();
  private readonly activeConsumers = new Map<string, ActiveConsumer>();
  private connection: AmqpConnectionManager;
  private publisher: ChannelWrapper;
  private consumer: ChannelWrapper;
  private readonly retryBaseDelayMs: number;
  private stopping = false;

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {
    this.retryBaseDelayMs = config.get('RETRY_BASE_DELAY_MS', { infer: true });
  }

  onModuleInit(): void {
    this.connection = connect([this.config.get('RABBITMQ_URL', { infer: true })], {
      heartbeatIntervalInSeconds: 15,
      reconnectTimeInSeconds: 3,
    });
    this.connection.on('connect', () => this.logger.log('Conectado ao RabbitMQ'));
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn(
        `Conexão com o RabbitMQ perdida: ${err?.message ?? 'motivo desconhecido'}`,
      ),
    );

    const setup = (channel: Channel) => assertPaymentTopology(channel);
    this.publisher = this.connection.createChannel({
      name: 'payment-publisher',
      confirm: true,
      publishTimeout: PUBLISH_TIMEOUT_MS,
      setup,
    });
    this.consumer = this.connection.createChannel({
      name: 'payment-consumer',
      confirm: false,
      setup,
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    for (const [queue, { channel, consumerTag }] of this.activeConsumers) {
      try {
        await channel.cancel(consumerTag);
      } catch {
        this.logger.warn(`Consumidor da fila ${queue} já estava encerrado`);
      }
    }
    this.activeConsumers.clear();
    if (this.inFlight.size > 0) {
      this.logger.log(`Aguardando ${this.inFlight.size} mensagem(ns) em processamento`);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, DRAIN_TIMEOUT_MS);
      });
      await Promise.race([Promise.allSettled([...this.inFlight]), timeout]);
      clearTimeout(timer);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer?.close();
    await this.publisher?.close();
    await this.connection?.close();
  }

  isConnected(): boolean {
    return this.connection?.isConnected() ?? false;
  }

  async publish(
    routingKey: string,
    message: unknown,
    metadata: PublishMetadata,
  ): Promise<void> {
    await this.publisher.publish(
      PAYMENTS_EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId: metadata.messageId,
        type: metadata.type,
        correlationId: metadata.correlationId,
        timestamp: Math.floor(Date.now() / 1000),
      },
    );
  }

  async consume(queue: string, handler: MessageHandler, prefetch: number): Promise<void> {
    await this.consumer.addSetup(async (channel: Channel) => {
      if (this.stopping) return;
      await channel.prefetch(prefetch);
      const { consumerTag } = await channel.consume(
        queue,
        (message) => {
          if (message) this.track(this.dispatch(channel, queue, message, handler));
        },
        { noAck: false },
      );
      this.activeConsumers.set(queue, { channel, consumerTag });
      this.logger.log(`Consumindo a fila ${queue} (prefetch ${prefetch})`);
    });
  }

  private track(processing: Promise<void>): void {
    this.inFlight.add(processing);
    void processing.finally(() => this.inFlight.delete(processing));
  }

  private async dispatch(
    channel: Channel,
    queue: string,
    message: ConsumeMessage,
    handler: MessageHandler,
  ): Promise<void> {
    let settlement: Settlement;
    try {
      settlement = await handler(message);
    } catch (error) {
      const attempt = deliveryCount(message) + 1;
      this.logger.error(
        `Falha ao processar mensagem ${describe(message)} da fila ${queue} ` +
          `(tentativa ${attempt}); será devolvida à fila`,
        error instanceof Error ? error.stack : String(error),
      );
      await sleep(this.retryBaseDelayMs * attempt);
      settlement = 'retry';
    }
    this.settle(channel, message, settlement);
  }

  private settle(
    channel: Channel,
    message: ConsumeMessage,
    settlement: Settlement,
  ): void {
    try {
      if (settlement === 'ack') {
        channel.ack(message);
      } else if (settlement === 'reject') {
        this.logger.warn(`Mensagem ${describe(message)} rejeitada e enviada à DLQ`);
        channel.nack(message, false, false);
      } else {
        channel.nack(message, false, true);
      }
    } catch {
      this.logger.warn(
        `Canal fechado antes da confirmação da mensagem ${describe(message)}; ` +
          'o RabbitMQ vai reentregá-la',
      );
    }
  }
}

function deliveryCount(message: ConsumeMessage): number {
  const headers = message.properties.headers as Record<string, unknown> | undefined;
  const count = headers?.['x-delivery-count'];
  return typeof count === 'number' ? count : 0;
}

function describe(message: ConsumeMessage): string {
  const id: unknown = message.properties.messageId;
  return typeof id === 'string' ? id : `sem id (delivery ${message.fields.deliveryTag})`;
}
