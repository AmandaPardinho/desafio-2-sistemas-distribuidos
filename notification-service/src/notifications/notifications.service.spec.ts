import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildEvent } from '../test-utils/payment-event.fixture';
import { NotificationSender } from './notification-sender';
import { NotificationsService } from './notifications.service';
import { PaymentEventType } from './payment-event';

function createService() {
  const tx = { notification: { create: jest.fn().mockResolvedValue({}) } };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    notification: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const sender = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new NotificationsService(
    prisma as unknown as PrismaService,
    sender as unknown as NotificationSender,
  );
  return { service, tx, prisma, sender };
}

describe('NotificationsService', () => {
  it('registra a notificação e envia ao cliente na mesma transação', async () => {
    const { service, tx, prisma, sender } = createService();
    const event = buildEvent(PaymentEventType.CONFIRMED);

    await expect(service.notify(event)).resolves.toBe('sent');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: event.eventId,
        paymentId: event.data.paymentId,
        type: NotificationType.PAYMENT_CONFIRMED,
        recipient: 'cliente@exemplo.com',
      }),
    });
    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: event.eventId,
        recipient: 'cliente@exemplo.com',
        subject: 'Pagamento do pedido PED-1 confirmado',
      }),
    );
  });

  it('é idempotente: evento já notificado não é enviado de novo', async () => {
    const { service, tx, sender } = createService();
    tx.notification.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: Prisma.prismaVersion.client,
      }),
    );

    await expect(service.notify(buildEvent())).resolves.toBe('duplicate');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('propaga falha no envio para a transação ser desfeita', async () => {
    const { service, sender } = createService();
    sender.send.mockRejectedValue(new Error('SMTP indisponível'));

    await expect(service.notify(buildEvent())).rejects.toThrow('SMTP indisponível');
  });

  it('lista as notificações de um pagamento em ordem cronológica', async () => {
    const { service, prisma } = createService();

    await service.list('3f1c9a52-6f0e-4c1b-9d8e-2a7b5c4d3e21');

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { paymentId: '3f1c9a52-6f0e-4c1b-9d8e-2a7b5c4d3e21' },
      orderBy: { sentAt: 'asc' },
      take: 100,
    });
  });

  it('lista as notificações mais recentes quando não há filtro', async () => {
    const { service, prisma } = createService();

    await service.list();

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { sentAt: 'desc' },
      take: 100,
    });
  });
});
