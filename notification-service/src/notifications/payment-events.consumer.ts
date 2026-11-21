import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConsumeMessage } from 'amqplib';
import { EnvironmentVariables } from '../config/env';
import { ConsumeResult, RabbitMqService } from '../messaging/rabbitmq.service';
import { NOTIFICATION_QUEUE } from '../messaging/topology';
import { NotificationsService } from './notifications.service';
import { parsePaymentEvent } from './payment-event';

@Injectable()
export class PaymentEventsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentEventsConsumer.name);

  constructor(
    private readonly rabbit: RabbitMqService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.rabbit.consume(
      NOTIFICATION_QUEUE,
      (message) => this.handle(message),
      this.config.get('NOTIFICATION_PREFETCH', { infer: true }),
    );
  }

  async handle(message: ConsumeMessage): Promise<ConsumeResult> {
    const event = parsePaymentEvent(message.content);
    if (!event) {
      this.logger.warn(`Mensagem inválida na fila ${NOTIFICATION_QUEUE}`);
      return 'reject';
    }

    const result = await this.notifications.notify(event);
    if (result === 'duplicate') {
      this.logger.log(
        `Evento ${event.eventId} já notificado; mensagem duplicada ignorada`,
      );
    } else {
      this.logger.log(
        `Notificação ${event.type} enviada (pagamento ${event.data.paymentId})`,
      );
    }
    return 'ack';
  }
}
