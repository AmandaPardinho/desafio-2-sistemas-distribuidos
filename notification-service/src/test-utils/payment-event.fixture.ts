import { PaymentEvent, PaymentEventType } from '../notifications/payment-event';

export function buildEvent(
  type: PaymentEventType = PaymentEventType.REQUESTED,
  overrides: Partial<PaymentEvent> = {},
): PaymentEvent {
  return {
    eventId: '7d9f8e1a-2b3c-4d5e-8f60-718293a4b5c6',
    type,
    occurredAt: '2026-11-21T10:00:00.000Z',
    data: {
      paymentId: '3f1c9a52-6f0e-4c1b-9d8e-2a7b5c4d3e21',
      orderId: 'PED-1',
      customerId: 'CLI-1',
      customerEmail: 'cliente@exemplo.com',
      amount: '1259.90',
      currency: 'BRL',
      status: type === PaymentEventType.REQUESTED ? 'PENDING' : 'SUCCESS',
    },
    ...overrides,
  };
}
