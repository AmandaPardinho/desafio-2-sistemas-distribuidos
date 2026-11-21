import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '@prisma/client';
import type { ConsumeMessage } from 'amqplib';
import { EnvironmentVariables } from '../config/env';
import { ConsumeResult, RabbitMqService } from '../messaging/rabbitmq.service';
import { PAYMENT_PROCESSING_QUEUE } from '../messaging/topology';
import { PaymentGateway } from './payment-gateway';
import { PaymentEventType, parsePaymentEvent } from './payment-events';
import { PaymentsService } from './payments.service';

@Injectable()
export class PaymentProcessorConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentProcessorConsumer.name);

  constructor(
    private readonly rabbit: RabbitMqService,
    private readonly payments: PaymentsService,
    private readonly gateway: PaymentGateway,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.rabbit.consume(
      PAYMENT_PROCESSING_QUEUE,
      (message) => this.handle(message),
      this.config.get('PROCESSING_PREFETCH', { infer: true }),
    );
  }

  async handle(message: ConsumeMessage): Promise<ConsumeResult> {
    const event = parsePaymentEvent(message.content);
    if (!event || event.type !== PaymentEventType.REQUESTED) {
      this.logger.warn(`Mensagem inválida na fila ${PAYMENT_PROCESSING_QUEUE}`);
      return 'reject';
    }

    const { paymentId, amount, currency } = event.data;
    const status = await this.payments.findStatus(paymentId);
    if (status === null) {
      this.logger.warn(`Pagamento ${paymentId} não existe; mensagem descartada`);
      return 'reject';
    }
    if (status !== PaymentStatus.PENDING) {
      this.logger.log(
        `Pagamento ${paymentId} já processado; mensagem duplicada ignorada`,
      );
      return 'ack';
    }

    await this.gateway.authorize({
      paymentId,
      amount,
      currency,
      idempotencyKey: paymentId,
    });
    const result = await this.payments.confirmPayment(paymentId);

    switch (result) {
      case 'confirmed':
        this.logger.log(`Pagamento ${paymentId} confirmado: status SUCCESS`);
        break;
      case 'already-confirmed':
        this.logger.log(
          `Pagamento ${paymentId} já estava confirmado; mensagem duplicada ignorada`,
        );
        break;
      case 'not-found':
        this.logger.warn(`Pagamento ${paymentId} não existe; mensagem descartada`);
        return 'reject';
    }
    return 'ack';
  }
}
