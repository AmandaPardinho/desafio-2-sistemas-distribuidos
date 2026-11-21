import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { PaymentGateway, SimulatedPaymentGateway } from './payment-gateway';
import { PaymentProcessorConsumer } from './payment-processor.consumer';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [OutboxModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentProcessorConsumer,
    { provide: PaymentGateway, useClass: SimulatedPaymentGateway },
  ],
})
export class PaymentsModule {}
