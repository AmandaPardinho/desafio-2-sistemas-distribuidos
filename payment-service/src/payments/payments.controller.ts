import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Solicita um pagamento; a confirmação acontece de forma assíncrona',
  })
  @ApiAcceptedResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({ description: 'Corpo da requisição inválido' })
  @ApiConflictResponse({ description: 'Já existe pagamento para o pedido' })
  async create(
    @Body() dto: CreatePaymentDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentResponseDto> {
    const payment = await this.payments.requestPayment(dto);
    response.location(`/payments/${payment.id}`);
    return PaymentResponseDto.from(payment);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consulta o status de um pagamento' })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiNotFoundResponse({ description: 'Pagamento não encontrado' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PaymentResponseDto> {
    return PaymentResponseDto.from(await this.payments.findById(id));
  }
}
