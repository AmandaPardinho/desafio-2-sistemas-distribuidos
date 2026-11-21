import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaymentEvent } from '../payments/payment-events';

@Injectable()
export class OutboxService {
  async enqueue(tx: Prisma.TransactionClient, event: PaymentEvent): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        id: event.eventId,
        routingKey: event.type,
        payload: event as unknown as Prisma.InputJsonObject,
      },
    });
  }
}
