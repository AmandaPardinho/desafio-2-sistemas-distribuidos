import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { RabbitMqService } from '../messaging/rabbitmq.service';
import { PrismaService } from '../prisma/prisma.service';

type DependencyStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'error';
  service: string;
  dependencies: { database: DependencyStatus; broker: DependencyStatus };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitMqService,
  ) {}

  @Get()
  @ApiOkResponse({ description: 'Serviço e dependências disponíveis' })
  @ApiServiceUnavailableResponse({ description: 'Alguma dependência indisponível' })
  async check(): Promise<HealthReport> {
    const database: DependencyStatus = (await this.prisma.isHealthy()) ? 'up' : 'down';
    const broker: DependencyStatus = this.rabbit.isConnected() ? 'up' : 'down';
    const healthy = database === 'up' && broker === 'up';
    const report: HealthReport = {
      status: healthy ? 'ok' : 'error',
      service: 'notification-service',
      dependencies: { database, broker },
    };
    if (!healthy) throw new ServiceUnavailableException(report);
    return report;
  }
}
