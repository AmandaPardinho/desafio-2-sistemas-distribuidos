import { Injectable } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationSender } from './notification-sender';
import { buildNotificationContent } from './notification-templates';
import { PaymentEvent } from './payment-event';

export type NotifyResult = 'sent' | 'duplicate';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const LIST_LIMIT = 100;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: NotificationSender,
  ) {}

  async notify(event: PaymentEvent): Promise<NotifyResult> {
    const content = buildNotificationContent(event);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.notification.create({
          data: {
            eventId: event.eventId,
            paymentId: event.data.paymentId,
            orderId: event.data.orderId,
            type: content.type,
            recipient: event.data.customerEmail,
            subject: content.subject,
            message: content.message,
          },
        });
        await this.sender.send({
          idempotencyKey: event.eventId,
          recipient: event.data.customerEmail,
          subject: content.subject,
          message: content.message,
        });
      });
      return 'sent';
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return 'duplicate';
      }
      throw error;
    }
  }

  async list(paymentId?: string): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: paymentId ? { paymentId } : undefined,
      orderBy: { sentAt: paymentId ? 'asc' : 'desc' },
      take: LIST_LIMIT,
    });
  }
}
