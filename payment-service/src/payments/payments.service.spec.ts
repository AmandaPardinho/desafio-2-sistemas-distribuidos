import { ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildPayment } from '../test-utils/payment.fixture';
import { PaymentEventType } from './payment-events';
import { PaymentsService } from './payments.service';

function createMocks() {
  const tx = {
    payment: {
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    payment: { findUnique: jest.fn() },
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    outbox as unknown as OutboxService,
  );
  return { tx, prisma, outbox, service };
}

const dto = {
  orderId: 'PED-1',
  customerId: 'CLI-1',
  customerEmail: 'cliente@exemplo.com',
  amount: 150.5,
};

describe('PaymentsService', () => {
  describe('requestPayment', () => {
    it('grava o pagamento como PENDING e enfileira payment.requested na mesma transação', async () => {
      const { tx, prisma, outbox, service } = createMocks();
      const payment = buildPayment();
      tx.payment.create.mockResolvedValue(payment);

      await expect(service.requestPayment(dto)).resolves.toBe(payment);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const data = tx.payment.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        orderId: 'PED-1',
        customerEmail: 'cliente@exemplo.com',
      });
      expect(data.amount.toFixed(2)).toBe('150.50');
      expect(data.status).toBeUndefined();
      expect(outbox.enqueue).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          type: PaymentEventType.REQUESTED,
          data: expect.objectContaining({ paymentId: payment.id, status: 'PENDING' }),
        }),
      );
    });

    it('responde 409 quando já existe pagamento para o pedido', async () => {
      const { tx, service } = createMocks();
      tx.payment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: Prisma.prismaVersion.client,
        }),
      );

      await expect(service.requestPayment(dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('não esconde outros erros do banco', async () => {
      const { tx, service } = createMocks();
      tx.payment.create.mockRejectedValue(new Error('conexão recusada'));

      await expect(service.requestPayment(dto)).rejects.toThrow('conexão recusada');
    });
  });

  describe('findById', () => {
    it('devolve o pagamento encontrado', async () => {
      const { prisma, service } = createMocks();
      const payment = buildPayment();
      prisma.payment.findUnique.mockResolvedValue(payment);

      await expect(service.findById(payment.id)).resolves.toBe(payment);
    });

    it('responde 404 quando o pagamento não existe', async () => {
      const { prisma, service } = createMocks();
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(service.findById('inexistente')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('confirmPayment', () => {
    it('muda PENDING para SUCCESS e enfileira payment.confirmed', async () => {
      const { tx, outbox, service } = createMocks();
      const confirmed = buildPayment({
        status: PaymentStatus.SUCCESS,
        confirmedAt: new Date(),
      });
      tx.payment.updateMany.mockResolvedValue({ count: 1 });
      tx.payment.findUniqueOrThrow.mockResolvedValue(confirmed);

      await expect(service.confirmPayment(confirmed.id)).resolves.toBe('confirmed');

      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: confirmed.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.SUCCESS, confirmedAt: expect.any(Date) },
      });
      expect(outbox.enqueue).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          type: PaymentEventType.CONFIRMED,
          data: expect.objectContaining({ status: 'SUCCESS' }),
        }),
      );
    });

    it('é idempotente: pagamento já confirmado não gera novo evento', async () => {
      const { tx, outbox, service } = createMocks();
      tx.payment.updateMany.mockResolvedValue({ count: 0 });
      tx.payment.count.mockResolvedValue(1);

      await expect(service.confirmPayment('id')).resolves.toBe('already-confirmed');
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('sinaliza pagamento inexistente', async () => {
      const { tx, outbox, service } = createMocks();
      tx.payment.updateMany.mockResolvedValue({ count: 0 });
      tx.payment.count.mockResolvedValue(0);

      await expect(service.confirmPayment('id')).resolves.toBe('not-found');
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });
  });
});
