import { Injectable, Logger } from '@nestjs/common';

export interface OutgoingNotification {
  idempotencyKey: string;
  recipient: string;
  subject: string;
  message: string;
}

export abstract class NotificationSender {
  abstract send(notification: OutgoingNotification): Promise<void>;
}

@Injectable()
export class ConsoleEmailSender extends NotificationSender {
  private readonly logger = new Logger('EmailSender');

  send(notification: OutgoingNotification): Promise<void> {
    this.logger.log(
      `E-mail enviado para ${notification.recipient} | ${notification.subject} | ` +
        `${notification.message} [chave ${notification.idempotencyKey}]`,
    );
    return Promise.resolve();
  }
}
