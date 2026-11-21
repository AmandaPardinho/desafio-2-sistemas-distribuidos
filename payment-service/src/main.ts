import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { EnvironmentVariables } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('CompreFácil — Payment Service')
      .setDescription('Recebe solicitações de pagamento e publica eventos no RabbitMQ')
      .setVersion('1.0.0')
      .build(),
  );
  SwaggerModule.setup('docs', app, document);

  const port = app
    .get(ConfigService<EnvironmentVariables, true>)
    .get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(
    `Payment service ouvindo na porta ${port} (documentação em /docs)`,
    'Bootstrap',
  );
}

void bootstrap();
