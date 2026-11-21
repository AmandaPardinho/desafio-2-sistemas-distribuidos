import { ConfigService } from '@nestjs/config';
import type { ConsumeMessage } from 'amqplib';
import { EnvironmentVariables } from '../config/env';
import { RabbitMqService } from '../messaging/rabbitmq.service';
import { buildEvent } from '../test-utils/payment-event.fixture';
import { NotificationsService } from './notifications.service';
import { PaymentEventsConsumer } from './payment-events.consumer';

function message(content: unknown): ConsumeMessage {
  const body = typeof content === 'string' ? content : JSON.stringify(content);
  return { content: Buffer.from(body), fields: {}, properties: {} } as ConsumeMessage;
}

function createConsumer() {
  const notifications = { notify: jest.fn().mockResolvedValue('sent') };
  const consumer = new PaymentEventsConsumer(
    {} as RabbitMqService,
    notifications as unknown as NotificationsService,
    {} as ConfigService<EnvironmentVariables, true>,
  );
  return { consumer, notifications };
}

describe('PaymentEventsConsumer', () => {
  it('notifica o cliente e dá ack', async () => {
    const { consumer, notifications } = createConsumer();
    const event = buildEvent();

    await expect(consumer.handle(message(event))).resolves.toBe('ack');
    expect(notifications.notify).toHaveBeenCalledWith(event);
  });

  it('dá ack em evento duplicado sem notificar de novo', async () => {
    const { consumer, notifications } = createConsumer();
    notifications.notify.mockResolvedValue('duplicate');

    await expect(consumer.handle(message(buildEvent()))).resolves.toBe('ack');
  });

  it('rejeita mensagem inválida sem tentar notificar', async () => {
    const { consumer, notifications } = createConsumer();

    await expect(consumer.handle(message('lixo'))).resolves.toBe('reject');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('propaga falha de infraestrutura para a mensagem voltar à fila', async () => {
    const { consumer, notifications } = createConsumer();
    notifications.notify.mockRejectedValue(new Error('banco fora do ar'));

    await expect(consumer.handle(message(buildEvent()))).rejects.toThrow(
      'banco fora do ar',
    );
  });
});
