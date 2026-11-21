import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as sleep } from 'node:timers/promises';
import { EnvironmentVariables } from '../config/env';

export interface AuthorizationRequest {
  paymentId: string;
  amount: string;
  currency: string;
  idempotencyKey: string;
}

export abstract class PaymentGateway {
  abstract authorize(request: AuthorizationRequest): Promise<void>;
}

@Injectable()
export class SimulatedPaymentGateway extends PaymentGateway {
  private readonly logger = new Logger(SimulatedPaymentGateway.name);
  private readonly delayMs: number;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super();
    this.delayMs = config.get('PAYMENT_CONFIRMATION_DELAY_MS', { infer: true });
  }

  async authorize(request: AuthorizationRequest): Promise<void> {
    this.logger.log(
      `Autorizando ${request.currency} ${request.amount} do pagamento ${request.paymentId} ` +
        `(chave de idempotência ${request.idempotencyKey}, simulado em ${this.delayMs} ms)`,
    );
    await sleep(this.delayMs);
  }
}
