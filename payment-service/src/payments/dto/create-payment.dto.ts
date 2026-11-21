import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({
    example: 'PED-2026-0001',
    description: 'Identificador do pedido no e-commerce',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  orderId: string;

  @ApiProperty({ example: 'CLI-42', description: 'Identificador do cliente' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  customerId: string;

  @ApiProperty({
    example: 'cliente@comprefacil.com.br',
    description: 'E-mail que recebe as notificações',
  })
  @IsEmail()
  @MaxLength(254)
  customerEmail: string;

  @ApiProperty({
    example: 259.9,
    description: 'Valor em reais, com até 2 casas decimais',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000)
  amount: number;
}
