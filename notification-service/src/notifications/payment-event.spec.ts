import { buildEvent } from '../test-utils/payment-event.fixture';
import { PaymentEventType, parsePaymentEvent } from './payment-event';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('parsePaymentEvent', () => {
  it.each([PaymentEventType.REQUESTED, PaymentEventType.CONFIRMED])(
    'aceita o evento %s publicado pelo serviço de pagamento',
    (type) => {
      const event = buildEvent(type);
      expect(parsePaymentEvent(encode(event))).toEqual(event);
    },
  );

  it('rejeita conteúdo que não é JSON', () => {
    expect(parsePaymentEvent(Buffer.from('isso não é json'))).toBeNull();
  });

  it('rejeita tipo de evento desconhecido', () => {
    expect(
      parsePaymentEvent(encode({ ...buildEvent(), type: 'payment.refunded' })),
    ).toBeNull();
  });

  it('rejeita eventId que não é UUID', () => {
    expect(parsePaymentEvent(encode({ ...buildEvent(), eventId: '123' }))).toBeNull();
  });

  it.each(['paymentId', 'orderId', 'customerEmail', 'amount', 'currency'])(
    'rejeita evento sem %s',
    (field) => {
      const event = buildEvent();
      const data: Record<string, unknown> = { ...event.data };
      delete data[field];
      expect(parsePaymentEvent(encode({ ...event, data }))).toBeNull();
    },
  );

  it.each([
    ['status incoerente com o tipo', { status: 'SUCCESS' }],
    ['valor negativo', { amount: '-10.00' }],
    ['valor infinito', { amount: 'Infinity' }],
    ['moeda não suportada', { currency: 'XYZ' }],
    ['e-mail sem arroba', { customerEmail: 'cliente' }],
    ['e-mail só com arroba', { customerEmail: '@' }],
    ['pedido longo demais', { orderId: 'x'.repeat(65) }],
  ])('rejeita evento com %s', (_caso, override) => {
    const event = buildEvent();
    expect(
      parsePaymentEvent(encode({ ...event, data: { ...event.data, ...override } })),
    ).toBeNull();
  });

  it.each(['ontem', '1', '2026-02-30T10:00:00.000Z'])(
    'rejeita data de ocorrência fora do ISO 8601 estrito: %s',
    (occurredAt) => {
      expect(parsePaymentEvent(encode({ ...buildEvent(), occurredAt }))).toBeNull();
    },
  );

  it('rejeita valor que não é número', () => {
    const event = buildEvent();
    expect(
      parsePaymentEvent(encode({ ...event, data: { ...event.data, amount: 'abc' } })),
    ).toBeNull();
  });
});
