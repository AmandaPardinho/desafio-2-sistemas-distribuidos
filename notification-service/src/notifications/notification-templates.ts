import { NotificationType } from '@prisma/client';
import { PaymentEvent, PaymentEventType } from './payment-event';

export interface NotificationContent {
  type: NotificationType;
  subject: string;
  message: string;
}

export function formatAmount(amount: string, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(
    Number(amount),
  );
}

export function buildNotificationContent(event: PaymentEvent): NotificationContent {
  const { orderId, amount, currency } = event.data;
  const value = formatAmount(amount, currency);

  switch (event.type) {
    case PaymentEventType.REQUESTED:
      return {
        type: NotificationType.PAYMENT_REQUESTED,
        subject: `Recebemos o pagamento do pedido ${orderId}`,
        message:
          `Olá! Recebemos a solicitação de pagamento de ${value} referente ao pedido ` +
          `${orderId}. Ela está em processamento e avisaremos assim que for confirmada.`,
      };
    case PaymentEventType.CONFIRMED:
      return {
        type: NotificationType.PAYMENT_CONFIRMED,
        subject: `Pagamento do pedido ${orderId} confirmado`,
        message:
          `Tudo certo! O pagamento de ${value} referente ao pedido ${orderId} foi ` +
          `confirmado. Obrigado por comprar na CompreFácil.`,
      };
  }
}
