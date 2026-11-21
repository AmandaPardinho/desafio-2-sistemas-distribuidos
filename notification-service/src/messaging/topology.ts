import type { Channel } from 'amqplib';

export const PAYMENTS_EXCHANGE = 'payments.events';
export const PAYMENT_EVENTS_BINDING = 'payment.*';

export const NOTIFICATION_QUEUE = 'notification-service.payment-events';
export const NOTIFICATION_DLQ = 'notification-service.payment-events.dlq';

export const MAX_REDELIVERIES = 3;

export async function assertNotificationTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(PAYMENTS_EXCHANGE, 'topic', { durable: true });
  await channel.assertQueue(NOTIFICATION_DLQ, { durable: true });
  await channel.assertQueue(NOTIFICATION_QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-delivery-limit': MAX_REDELIVERIES,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': NOTIFICATION_DLQ,
    },
  });
  await channel.bindQueue(NOTIFICATION_QUEUE, PAYMENTS_EXCHANGE, PAYMENT_EVENTS_BINDING);
}
