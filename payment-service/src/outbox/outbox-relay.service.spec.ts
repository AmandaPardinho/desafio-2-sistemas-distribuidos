import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env';
import { RabbitMqService } from '../messaging/rabbitmq.service';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxRelayService } from './outbox-relay.service';

function row(id: string) {
  return {
    id,
    routingKey: 'payment.requested',
    payload: { eventId: id, data: { paymentId: `pagamento-${id}` } },
  };
}

function createRelay(rows: ReturnType<typeof row>[]) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(rows),
    outboxEvent: { update: jest.fn().mockResolvedValue(undefined) },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const rabbit = {
    isConnected: jest.fn().mockReturnValue(true),
    publish: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn().mockReturnValue(500) };
  const relay = new OutboxRelayService(
    prisma as unknown as PrismaService,
    rabbit as unknown as RabbitMqService,
    config as unknown as ConfigService<EnvironmentVariables, true>,
  );
  return { relay, tx, prisma, rabbit };
}

describe('OutboxRelayService', () => {
  it('publica os eventos pendentes em ordem e marca cada um como publicado', async () => {
    const { relay, tx, rabbit } = createRelay([row('1'), row('2')]);

    await expect(relay.publishPending()).resolves.toBe(2);

    expect(rabbit.publish.mock.calls.map((call) => call[2].messageId)).toEqual([
      '1',
      '2',
    ]);
    expect(rabbit.publish).toHaveBeenCalledWith('payment.requested', row('1').payload, {
      messageId: '1',
      type: 'payment.requested',
      correlationId: 'pagamento-1',
    });
    expect(tx.outboxEvent.update).toHaveBeenCalledTimes(2);
    expect(tx.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { publishedAt: expect.any(Date) },
    });
  });

  it('para no primeiro evento que o broker não confirmar e mantém o restante pendente', async () => {
    const { relay, tx, rabbit } = createRelay([row('1'), row('2'), row('3')]);
    rabbit.publish
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('timeout'));

    await expect(relay.publishPending()).resolves.toBe(1);

    expect(rabbit.publish).toHaveBeenCalledTimes(2);
    expect(tx.outboxEvent.update).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: '1' } }),
    );
  });

  it('não abre transação enquanto o broker está desconectado', async () => {
    const { relay, prisma, rabbit } = createRelay([row('1')]);
    rabbit.isConnected.mockReturnValue(false);

    await expect(relay.publishPending()).resolves.toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
