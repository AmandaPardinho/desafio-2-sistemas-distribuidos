import { NotificationType } from '@prisma/client';
import { buildEvent } from '../test-utils/payment-event.fixture';
import { buildNotificationContent, formatAmount } from './notification-templates';
import { PaymentEventType } from './payment-event';

describe('notification templates', () => {
  it('formata o valor em reais', () => {
    expect(formatAmount('1259.90', 'BRL')).toBe('R$ 1.259,90');
  });

  it('avisa o recebimento da solicitação de pagamento', () => {
    const content = buildNotificationContent(buildEvent(PaymentEventType.REQUESTED));

    expect(content.type).toBe(NotificationType.PAYMENT_REQUESTED);
    expect(content.subject).toBe('Recebemos o pagamento do pedido PED-1');
    expect(content.message).toContain('R$ 1.259,90');
    expect(content.message).toContain('em processamento');
  });

  it('avisa a confirmação do pagamento', () => {
    const content = buildNotificationContent(buildEvent(PaymentEventType.CONFIRMED));

    expect(content.type).toBe(NotificationType.PAYMENT_CONFIRMED);
    expect(content.subject).toBe('Pagamento do pedido PED-1 confirmado');
    expect(content.message).toContain('confirmado');
  });
});
