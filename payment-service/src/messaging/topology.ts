import type { Channel } from 'amqplib';
import { PaymentEventType } from '../payments/payment-events';

export const PAYMENTS_EXCHANGE = 'payments.events';

export const PAYMENT_PROCESSING_QUEUE = 'payment-service.process-payment';
export const PAYMENT_PROCESSING_DLQ = 'payment-service.process-payment.dlq';

export const MAX_REDELIVERIES = 3;

export async function assertPaymentTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(PAYMENTS_EXCHANGE, 'topic', { durable: true });
  await channel.assertQueue(PAYMENT_PROCESSING_DLQ, { durable: true });
  await channel.assertQueue(PAYMENT_PROCESSING_QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-delivery-limit': MAX_REDELIVERIES,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': PAYMENT_PROCESSING_DLQ,
    },
  });
  await channel.bindQueue(
    PAYMENT_PROCESSING_QUEUE,
    PAYMENTS_EXCHANGE,
    PaymentEventType.REQUESTED,
  );
}
