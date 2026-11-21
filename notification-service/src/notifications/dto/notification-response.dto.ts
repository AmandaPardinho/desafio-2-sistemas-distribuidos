import { ApiProperty } from '@nestjs/swagger';
import { Notification, NotificationChannel, NotificationType } from '@prisma/client';

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Evento que originou a notificação' })
  eventId: string;

  @ApiProperty({ format: 'uuid' })
  paymentId: string;

  @ApiProperty({ example: 'PED-2026-0001' })
  orderId: string;

  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

  @ApiProperty({ enum: NotificationChannel })
  channel: NotificationChannel;

  @ApiProperty({ example: 'cliente@comprefacil.com.br' })
  recipient: string;

  @ApiProperty()
  subject: string;

  @ApiProperty()
  message: string;

  @ApiProperty({ format: 'date-time' })
  sentAt: string;

  static from(notification: Notification): NotificationResponseDto {
    return { ...notification, sentAt: notification.sentAt.toISOString() };
  }
}
