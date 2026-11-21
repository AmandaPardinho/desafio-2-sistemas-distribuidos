import { buildPayment } from '../test-utils/payment.fixture';
import { PaymentEventType, buildPaymentEvent, parsePaymentEvent } from './payment-events';

describe('payment events', () => {
  const payment = buildPayment();

  it('monta o evento com o contrato esperado pelos consumidores', () => {
    const event = buildPaymentEvent(
      PaymentEventType.REQUESTED,
      payment,
      'a0a0a0a0-0000-4000-8000-000000000001',
      new Date('2026-11-21T10:00:01.000Z'),
    );

    expect(event).toEqual({
      eventId: 'a0a0a0a0-0000-4000-8000-000000000001',
      type: 'payment.requested',
      occurredAt: '2026-11-21T10:00:01.000Z',
      data: {
        paymentId: payment.id,
        orderId: 'PED-1',
        customerId: 'CLI-1',
        customerEmail: 'cliente@exemplo.com',
        amount: '150.50',
        currency: 'BRL',
        status: 'PENDING',
      },
    });
  });

  it('gera um eventId diferente para cada evento', () => {
    const first = buildPaymentEvent(PaymentEventType.REQUESTED, payment);
    const second = buildPaymentEvent(PaymentEventType.REQUESTED, payment);
    expect(first.eventId).not.toBe(second.eventId);
  });

  it('lê de volta um evento serializado', () => {
    const event = buildPaymentEvent(
      PaymentEventType.CONFIRMED,
      buildPayment({ status: 'SUCCESS' }),
    );
    expect(parsePaymentEvent(Buffer.from(JSON.stringify(event)))).toEqual(event);
  });

  it.each(['1', '2026-02-30T10:00:00.000Z', '21/11/2026'])(
    'rejeita data de ocorrência fora do ISO 8601 estrito: %s',
    (occurredAt) => {
      const event = buildPaymentEvent(PaymentEventType.REQUESTED, payment);
      expect(
        parsePaymentEvent(Buffer.from(JSON.stringify({ ...event, occurredAt }))),
      ).toBeNull();
    },
  );

  it.each([
    ['status incoerente com o tipo', { status: 'SUCCESS' }],
    ['valor negativo', { amount: '-10.00' }],
    ['valor sem centavos', { amount: '10' }],
    ['moeda inválida', { currency: 'reais' }],
    ['paymentId que não é UUID', { paymentId: '123' }],
    ['e-mail sem arroba', { customerEmail: 'cliente' }],
    ['e-mail só com arroba', { customerEmail: '@' }],
  ])('rejeita evento com %s', (_caso, override) => {
    const event = buildPaymentEvent(PaymentEventType.REQUESTED, payment);
    const tampered = { ...event, data: { ...event.data, ...override } };
    expect(parsePaymentEvent(Buffer.from(JSON.stringify(tampered)))).toBeNull();
  });

  it.each([
    ['texto que não é JSON', 'isso não é json'],
    ['array no lugar de objeto', '[]'],
    [
      'tipo desconhecido',
      JSON.stringify({
        eventId: 'x',
        type: 'payment.refunded',
        occurredAt: 'x',
        data: { paymentId: 'p' },
      }),
    ],
    [
      'sem paymentId',
      JSON.stringify({
        eventId: 'x',
        type: 'payment.requested',
        occurredAt: 'x',
        data: {},
      }),
    ],
    [
      'sem eventId',
      JSON.stringify({
        type: 'payment.requested',
        occurredAt: 'x',
        data: { paymentId: 'p' },
      }),
    ],
  ])('rejeita mensagem inválida: %s', (_caso, content) => {
    expect(parsePaymentEvent(Buffer.from(content))).toBeNull();
  });
});
