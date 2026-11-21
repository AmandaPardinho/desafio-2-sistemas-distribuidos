import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentEventType, buildPaymentEvent } from './payment-events';

export type ConfirmationResult = 'confirmed' | 'already-confirmed' | 'not-found';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async requestPayment(dto: CreatePaymentDto): Promise<Payment> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            orderId: dto.orderId,
            customerId: dto.customerId,
            customerEmail: dto.customerEmail,
            amount: new Prisma.Decimal(dto.amount.toFixed(2)),
          },
        });
        await this.outbox.enqueue(
          tx,
          buildPaymentEvent(PaymentEventType.REQUESTED, payment),
        );
        return payment;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException(
          `Já existe um pagamento para o pedido ${dto.orderId}`,
        );
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException(`Pagamento ${id} não encontrado`);
    }
    return payment;
  }

  async findStatus(id: string): Promise<PaymentStatus | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      select: { status: true },
    });
    return payment?.status ?? null;
  }

  async confirmPayment(id: string): Promise<ConfirmationResult> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.SUCCESS, confirmedAt: new Date() },
      });

      if (count === 0) {
        const exists = await tx.payment.count({ where: { id } });
        return exists > 0 ? 'already-confirmed' : 'not-found';
      }

      const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
      await this.outbox.enqueue(
        tx,
        buildPaymentEvent(PaymentEventType.CONFIRMED, payment),
      );
      return 'confirmed';
    });
  }
}
