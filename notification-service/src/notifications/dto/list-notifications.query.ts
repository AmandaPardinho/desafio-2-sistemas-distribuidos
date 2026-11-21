import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ListNotificationsQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filtra pelo pagamento' })
  @IsOptional()
  @IsUUID()
  paymentId?: string;
}
