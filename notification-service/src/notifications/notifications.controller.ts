import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListNotificationsQuery } from './dto/list-notifications.query';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as notificações enviadas aos clientes' })
  @ApiOkResponse({ type: NotificationResponseDto, isArray: true })
  async list(@Query() query: ListNotificationsQuery): Promise<NotificationResponseDto[]> {
    const notifications = await this.notifications.list(query.paymentId);
    return notifications.map((notification) =>
      NotificationResponseDto.from(notification),
    );
  }
}
