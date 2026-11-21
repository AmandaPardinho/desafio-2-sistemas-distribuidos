import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env';
import { RabbitMqService } from '../messaging/rabbitmq.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PaymentEvent } from '../payments/payment-events';

interface PendingOutboxRow {
  id: string;
  routingKey: string;
  payload: PaymentEvent;
}

const BATCH_SIZE = 50;
const TRANSACTION_TIMEOUT_MS = 30_000;

@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitMqService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.pollIntervalMs = config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.stopped = false;
    this.schedule();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  async publishPending(): Promise<number> {
    if (!this.rabbit.isConnected()) return 0;

    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<PendingOutboxRow[]>`
          SELECT id, routing_key AS "routingKey", payload
          FROM outbox_events
          WHERE published_at IS NULL
          ORDER BY created_at
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED`;

        let published = 0;
        for (const row of rows) {
          try {
            await this.rabbit.publish(row.routingKey, row.payload, {
              messageId: row.id,
              type: row.routingKey,
              correlationId: row.payload.data.paymentId,
            });
          } catch (error) {
            this.logger.warn(
              `Evento ${row.id} não confirmado pelo broker; nova tentativa no próximo ciclo ` +
                `(${error instanceof Error ? error.message : String(error)})`,
            );
            break;
          }
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: { publishedAt: new Date() },
          });
          published++;
          this.logger.log(
            `Evento ${row.routingKey} publicado (pagamento ${row.payload.data.paymentId})`,
          );
        }
        return published;
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick();
    }, this.pollIntervalMs);
  }

  private async tick(): Promise<void> {
    try {
      await this.publishPending();
    } catch (error) {
      this.logger.error(
        'Falha ao publicar eventos pendentes do outbox',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = null;
      this.schedule();
    }
  }
}
