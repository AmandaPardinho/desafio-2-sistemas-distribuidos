import { plainToInstance } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, Min, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  RABBITMQ_URL: string;

  @IsInt()
  @Min(0)
  PAYMENT_CONFIRMATION_DELAY_MS: number = 3000;

  @IsInt()
  @Min(50)
  OUTBOX_POLL_INTERVAL_MS: number = 500;

  @IsInt()
  @Min(1)
  PROCESSING_PREFETCH: number = 10;

  @IsInt()
  @Min(0)
  RETRY_BASE_DELAY_MS: number = 1000;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map(
        (error) =>
          `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
      )
      .join('; ');
    throw new Error(`Variáveis de ambiente inválidas: ${details}`);
  }
  return env;
}
