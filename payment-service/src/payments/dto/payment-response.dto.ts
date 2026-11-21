import { ApiProperty } from '@nestjs/swagger';
import { Payment, PaymentStatus } from '@prisma/client';

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'PED-2026-0001' })
  orderId: string;

  @ApiProperty({ example: 'CLI-42' })
  customerId: string;

  @ApiProperty({ example: 'cliente@comprefacil.com.br' })
  customerEmail: string;

  @ApiProperty({ example: '259.90', description: 'Valor decimal serializado como texto' })
  amount: string;

  @ApiProperty({ example: 'BRL' })
  currency: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PENDING })
  status: PaymentStatus;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  confirmedAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  static from(payment: Payment): PaymentResponseDto {
    return {
      id: payment.id,
      orderId: payment.orderId,
      customerId: payment.customerId,
      customerEmail: payment.customerEmail,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      status: payment.status,
      confirmedAt: payment.confirmedAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}
