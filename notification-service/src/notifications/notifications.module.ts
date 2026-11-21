import { Module } from '@nestjs/common';
import { ConsoleEmailSender, NotificationSender } from './notification-sender';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PaymentEventsConsumer } from './payment-events.consumer';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PaymentEventsConsumer,
    { provide: NotificationSender, useClass: ConsoleEmailSender },
  ],
})
export class NotificationsModule {}
