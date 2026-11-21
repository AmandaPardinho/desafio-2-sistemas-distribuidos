import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env';
import type { ConsumeMessage } from 'amqplib';
import { RabbitMqService } from '../messaging/rabbitmq.service';
import { buildPayment } from '../test-utils/payment.fixture';
import { PaymentGateway } from './payment-gateway';
import { PaymentEventType, buildPaymentEvent } from './payment-events';
import { PaymentProcessorConsumer } from './payment-processor.consumer';
import { PaymentsService } from './payments.service';

function message(content: unknown): ConsumeMessage {
  const body = typeof content === 'string' ? content : JSON.stringify(content);
  return { content: Buffer.from(body), fields: {}, properties: {} } as ConsumeMessage;
}

function createConsumer() {
  const calls: string[] = [];
  const gateway = {
    authorize: jest.fn<Promise<void>, [unknown]>(() => {
      calls.push('authorize');
      return Promise.resolve();
    }),
  };
  const payments = {
    findStatus: jest.fn().mockResolvedValue('PENDING'),
    confirmPayment: jest.fn(() => {
      calls.push('confirm');
      return Promise.resolve('confirmed');
    }),
  };
  const consumer = new PaymentProcessorConsumer(
    {} as RabbitMqService,
    payments as unknown as PaymentsService,
    gateway as unknown as PaymentGateway,
    {} as ConfigService<EnvironmentVariables, true>,
  );
  return { consumer, gateway, payments, calls };
}

describe('PaymentProcessorConsumer', () => {
  const requested = buildPaymentEvent(PaymentEventType.REQUESTED, buildPayment());

  it('autoriza na operadora com chave de idempotência, confirma e dá ack', async () => {
    const { consumer, gateway, payments, calls } = createConsumer();

    await expect(consumer.handle(message(requested))).resolves.toBe('ack');

    expect(calls).toEqual(['authorize', 'confirm']);
    expect(gateway.authorize).toHaveBeenCalledWith({
      paymentId: requested.data.paymentId,
      amount: '150.50',
      currency: 'BRL',
      idempotencyKey: requested.data.paymentId,
    });
    expect(payments.confirmPayment).toHaveBeenCalledWith(requested.data.paymentId);
  });

  it('não chama a operadora de novo para pagamento que já saiu de PENDING', async () => {
    const { consumer, gateway, payments } = createConsumer();
    payments.findStatus.mockResolvedValue('SUCCESS');

    await expect(consumer.handle(message(requested))).resolves.toBe('ack');
    expect(gateway.authorize).not.toHaveBeenCalled();
    expect(payments.confirmPayment).not.toHaveBeenCalled();
  });

  it('rejeita evento de pagamento que não existe no banco', async () => {
    const { consumer, gateway, payments } = createConsumer();
    payments.findStatus.mockResolvedValue(null);

    await expect(consumer.handle(message(requested))).resolves.toBe('reject');
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('dá ack em mensagem duplicada de pagamento já confirmado', async () => {
    const { consumer, payments } = createConsumer();
    payments.confirmPayment.mockResolvedValue('already-confirmed');

    await expect(consumer.handle(message(requested))).resolves.toBe('ack');
  });

  it('rejeita evento de pagamento inexistente', async () => {
    const { consumer, payments } = createConsumer();
    payments.confirmPayment.mockResolvedValue('not-found');

    await expect(consumer.handle(message(requested))).resolves.toBe('reject');
  });

  it('rejeita mensagem inválida sem chamar a operadora', async () => {
    const { consumer, gateway } = createConsumer();

    await expect(consumer.handle(message('lixo'))).resolves.toBe('reject');
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('rejeita evento de outro tipo', async () => {
    const { consumer, gateway } = createConsumer();
    const confirmed = buildPaymentEvent(PaymentEventType.CONFIRMED, buildPayment());

    await expect(consumer.handle(message(confirmed))).resolves.toBe('reject');
    expect(gateway.authorize).not.toHaveBeenCalled();
  });

  it('propaga falha de infraestrutura para a mensagem voltar à fila', async () => {
    const { consumer, payments } = createConsumer();
    payments.confirmPayment.mockRejectedValue(new Error('banco fora do ar'));

    await expect(consumer.handle(message(requested))).rejects.toThrow('banco fora do ar');
  });
});
