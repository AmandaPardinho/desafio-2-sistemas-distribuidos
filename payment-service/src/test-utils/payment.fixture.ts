import { Payment, PaymentStatus, Prisma } from '@prisma/client';

export function buildPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '3f1c9a52-6f0e-4c1b-9d8e-2a7b5c4d3e21',
    orderId: 'PED-1',
    customerId: 'CLI-1',
    customerEmail: 'cliente@exemplo.com',
    amount: new Prisma.Decimal('150.50'),
    currency: 'BRL',
    status: PaymentStatus.PENDING,
    confirmedAt: null,
    createdAt: new Date('2026-11-21T10:00:00.000Z'),
    updatedAt: new Date('2026-11-21T10:00:00.000Z'),
    ...overrides,
  };
}
