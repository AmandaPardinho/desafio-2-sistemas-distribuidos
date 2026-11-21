import { ConfigService } from '@nestjs/config';
import { connect } from 'amqp-connection-manager';
import type { Channel, ConsumeMessage } from 'amqplib';
import { EnvironmentVariables } from '../config/env';
import { ConsumeResult, MessageHandler, RabbitMqService } from './rabbitmq.service';

jest.mock('amqp-connection-manager', () => ({ connect: jest.fn() }));

type OnMessage = (message: ConsumeMessage | null) => void;
type Setup = (channel: Channel) => Promise<void>;

function fakeChannel() {
  let onMessage: OnMessage = () => undefined;
  const channel = {
    prefetch: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn((_queue: string, handler: OnMessage) => {
      onMessage = handler;
      return Promise.resolve({ consumerTag: 'tag-1' });
    }),
    cancel: jest.fn().mockResolvedValue(undefined),
    ack: jest.fn(),
    nack: jest.fn(),
  };
  return { channel, deliver: (message: ConsumeMessage | null) => onMessage(message) };
}

function message(deliveryCount?: number): ConsumeMessage {
  return {
    content: Buffer.from('{}'),
    fields: { deliveryTag: 1, redelivered: false },
    properties: {
      messageId: 'm-1',
      headers: deliveryCount === undefined ? {} : { 'x-delivery-count': deliveryCount },
    },
  } as unknown as ConsumeMessage;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup() {
  const setups: Setup[] = [];
  const wrapper = {
    addSetup: jest.fn((fn: Setup) => {
      setups.push(fn);
      return Promise.resolve();
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const connection = {
    on: jest.fn(),
    createChannel: jest.fn().mockReturnValue(wrapper),
    isConnected: jest.fn().mockReturnValue(true),
    close: jest.fn().mockResolvedValue(undefined),
  };
  jest.mocked(connect).mockReturnValue(connection as never);

  const config = {
    get: jest.fn((key: string) =>
      key === 'RETRY_BASE_DELAY_MS' ? 0 : 'amqp://localhost',
    ),
  };
  const service = new RabbitMqService(
    config as unknown as ConfigService<EnvironmentVariables, true>,
  );
  service.onModuleInit();

  const startConsumer = async (handler: MessageHandler) => {
    await service.consume('fila', handler, 5);
    const fake = fakeChannel();
    await setups[0](fake.channel as unknown as Channel);
    return fake;
  };

  return { service, wrapper, setups, startConsumer };
}

describe('RabbitMqService', () => {
  it('registra o consumidor com ack manual e o prefetch configurado em cada canal', async () => {
    const { startConsumer } = setup();
    const { channel } = await startConsumer(() => Promise.resolve('ack'));

    expect(channel.prefetch).toHaveBeenCalledWith(5);
    expect(channel.consume).toHaveBeenCalledWith('fila', expect.any(Function), {
      noAck: false,
    });
  });

  it.each<[ConsumeResult | 'erro', unknown[]]>([
    ['ack', ['ack']],
    ['reject', ['nack', false, false]],
    ['erro', ['nack', false, true]],
  ])(
    'resultado %s do handler vira %j no canal que entregou',
    async (result, expected) => {
      const { startConsumer } = setup();
      const handler: MessageHandler =
        result === 'erro'
          ? () => Promise.reject(new Error('banco fora'))
          : () => Promise.resolve(result);
      const { channel, deliver } = await startConsumer(handler);
      const delivered = message();

      deliver(delivered);
      await flush();
      await flush();

      const [method, ...args] = expected as [keyof typeof channel, ...unknown[]];
      expect(channel[method]).toHaveBeenCalledWith(delivered, ...args);
    },
  );

  it('confirma no canal da entrega mesmo depois de uma reconexão', async () => {
    const { setups, startConsumer } = setup();
    let release: (value: ConsumeResult) => void = () => undefined;
    const first = await startConsumer(
      () => new Promise<ConsumeResult>((resolve) => (release = resolve)),
    );

    first.deliver(message());
    const second = fakeChannel();
    await setups[0](second.channel as unknown as Channel);
    release('ack');
    await flush();

    expect(first.channel.ack).toHaveBeenCalled();
    expect(second.channel.ack).not.toHaveBeenCalled();
  });

  it('não derruba o processo quando o canal fecha antes do ack', async () => {
    const { startConsumer } = setup();
    const { channel, deliver } = await startConsumer(() => Promise.resolve('ack'));
    channel.ack.mockImplementation(() => {
      throw new Error('Channel closed');
    });

    deliver(message());
    await flush();

    expect(channel.ack).toHaveBeenCalled();
  });

  it('ignora o aviso de cancelamento do broker (mensagem nula)', async () => {
    const { startConsumer } = setup();
    const handler = jest.fn();
    const { deliver } = await startConsumer(handler);

    deliver(null);
    await flush();

    expect(handler).not.toHaveBeenCalled();
  });

  it('no desligamento cancela o consumidor e espera a mensagem em andamento', async () => {
    const { service, startConsumer } = setup();
    let release: (value: ConsumeResult) => void = () => undefined;
    const { channel, deliver } = await startConsumer(
      () => new Promise<ConsumeResult>((resolve) => (release = resolve)),
    );
    deliver(message());

    let finished = false;
    const shutdown = service.onModuleDestroy().then(() => {
      finished = true;
    });
    await flush();
    expect(channel.cancel).toHaveBeenCalledWith('tag-1');
    expect(finished).toBe(false);
    expect(channel.ack).not.toHaveBeenCalled();

    release('ack');
    await shutdown;
    expect(channel.ack).toHaveBeenCalled();
  });

  it('não volta a consumir se a reconexão acontecer durante o desligamento', async () => {
    const { service, setups, startConsumer } = setup();
    await startConsumer(() => Promise.resolve('ack'));
    await service.onModuleDestroy();

    const late = fakeChannel();
    await setups[0](late.channel as unknown as Channel);

    expect(late.channel.consume).not.toHaveBeenCalled();
  });
});
