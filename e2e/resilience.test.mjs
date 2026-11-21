import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

const PAYMENT_URL = process.env.PAYMENT_URL ?? 'http://localhost:3000';
const NOTIFICATION_URL = process.env.NOTIFICATION_URL ?? 'http://localhost:3001';
const RABBITMQ_API = process.env.RABBITMQ_API ?? 'http://localhost:15672/api';
const RABBITMQ_AUTH = `Basic ${Buffer.from('admin:123456').toString('base64')}`;
const TIMEOUT_MS = 60_000;

function compose(...args) {
  return execFileSync('docker', ['compose', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const rabbit = (path, options = {}) =>
  json(`${RABBITMQ_API}${path}`, {
    ...options,
    headers: { authorization: RABBITMQ_AUTH, ...options.headers },
  });

async function eventually(check, description) {
  const deadline = Date.now() + TIMEOUT_MS;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last.done) return last.value;
    } catch (error) {
      last = { value: error.message };
    }
    await sleep(500);
  }
  assert.fail(
    `Tempo esgotado esperando: ${description} (último valor: ${JSON.stringify(last?.value)})`,
  );
}

const healthy = (url) =>
  eventually(async () => {
    const { status } = await json(`${url}/health`);
    return { done: status === 200, value: status };
  }, `${url} saudável`);

async function createPayment() {
  const { status, body } = await json(`${PAYMENT_URL}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      orderId: `RES-${randomUUID()}`,
      customerId: 'CLI-RES',
      customerEmail: 'resiliencia@comprefacil.com.br',
      amount: 42.5,
    }),
  });
  assert.equal(status, 202);
  return body.id;
}

const paymentStatus = async (id) =>
  (await json(`${PAYMENT_URL}/payments/${id}`)).body.status;
const notificationsOf = async (id) =>
  (await json(`${NOTIFICATION_URL}/notifications?paymentId=${id}`)).body;

const flowCompleted = (id) =>
  eventually(async () => {
    const [status, notifications] = await Promise.all([
      paymentStatus(id),
      notificationsOf(id),
    ]);
    return {
      done: status === 'SUCCESS' && notifications.length === 2,
      value: { status, notifications: notifications.map((n) => n.type) },
    };
  }, 'pagamento SUCCESS e 2 notificações');

const queueDepth = async (queue) =>
  (await rabbit(`/queues/%2F/${encodeURIComponent(queue)}`)).body.messages ?? 0;

describe('resiliência (derruba e religa contêineres)', { concurrency: false }, () => {
  it('pagamento segue sozinho com a notificação fora do ar, e os eventos esperam na fila', async () => {
    compose('stop', 'notification-service');
    try {
      const id = await createPayment();
      await eventually(async () => {
        const status = await paymentStatus(id);
        return { done: status === 'SUCCESS', value: status };
      }, 'SUCCESS sem a notificação');
      await eventually(async () => {
        const depth = await queueDepth('notification-service.payment-events');
        return { done: depth >= 2, value: depth };
      }, '2 eventos guardados na fila da notificação');

      compose('start', 'notification-service');
      await healthy(NOTIFICATION_URL);
      const notifications = await eventually(async () => {
        const list = await notificationsOf(id);
        return { done: list.length === 2, value: list };
      }, 'notificações entregues depois da volta');
      assert.deepEqual(
        notifications.map((n) => n.type),
        ['PAYMENT_REQUESTED', 'PAYMENT_CONFIRMED'],
      );
    } finally {
      compose('start', 'notification-service');
    }
  });

  it('nenhum evento se perde com o RabbitMQ fora do ar', async () => {
    compose('stop', 'rabbitmq');
    try {
      await eventually(async () => {
        const { status } = await json(`${PAYMENT_URL}/health`);
        return { done: status === 503, value: status };
      }, 'health 503 sem broker');

      const id = await createPayment();
      await sleep(2000);
      assert.equal(await paymentStatus(id), 'PENDING', 'sem broker, ninguém confirma');

      compose('start', 'rabbitmq');
      await healthy(PAYMENT_URL);
      await healthy(NOTIFICATION_URL);
      await flowCompleted(id);
    } finally {
      compose('start', 'rabbitmq');
    }
  });

  it('a fila existe antes do primeiro consumidor: topologia provisionada pelo broker', async () => {
    compose('stop', 'notification-service');
    try {
      const deleted = await rabbit(
        `/queues/%2F/${encodeURIComponent('notification-service.payment-events')}`,
        { method: 'DELETE' },
      );
      assert.equal(deleted.status, 204);

      compose('restart', 'rabbitmq');
      await healthy(PAYMENT_URL);
      const queue = await rabbit(
        `/queues/%2F/${encodeURIComponent('notification-service.payment-events')}`,
      );
      assert.equal(
        queue.status,
        200,
        'a fila volta junto com o broker, sem o consumidor',
      );
      assert.equal(queue.body.type, 'quorum');

      const id = await createPayment();
      compose('start', 'notification-service');
      await healthy(NOTIFICATION_URL);
      await flowCompleted(id);
    } finally {
      compose('start', 'notification-service');
    }
  });

  it('mensagem duplicada não notifica duas vezes e mensagem inválida vai para a DLQ', async () => {
    await healthy(PAYMENT_URL);
    await healthy(NOTIFICATION_URL);
    const id = await createPayment();
    await flowCompleted(id);
    const [confirmed] = (await notificationsOf(id)).filter(
      (n) => n.type === 'PAYMENT_CONFIRMED',
    );

    const replay = {
      eventId: confirmed.eventId,
      type: 'payment.confirmed',
      occurredAt: new Date().toISOString(),
      data: {
        paymentId: id,
        orderId: confirmed.orderId,
        customerId: 'CLI-RES',
        customerEmail: confirmed.recipient,
        amount: '42.50',
        currency: 'BRL',
        status: 'SUCCESS',
      },
    };
    const publish = (payload) =>
      rabbit('/exchanges/%2F/payments.events/publish', {
        method: 'POST',
        body: JSON.stringify({
          properties: { delivery_mode: 2 },
          routing_key: 'payment.confirmed',
          payload,
          payload_encoding: 'string',
        }),
      });

    const dlqBefore = await queueDepth('notification-service.payment-events.dlq');
    assert.equal((await publish(JSON.stringify(replay))).body.routed, true);
    assert.equal((await publish('isto não é um evento')).body.routed, true);

    await eventually(async () => {
      const depth = await queueDepth('notification-service.payment-events.dlq');
      return { done: depth === dlqBefore + 1, value: depth };
    }, 'mensagem inválida na DLQ');
    assert.equal(
      (await notificationsOf(id)).length,
      2,
      'a duplicata não gerou e-mail novo',
    );
  });

  it('falha temporária tem novas tentativas com intervalo crescente e depois vai para a DLQ', async () => {
    await healthy(NOTIFICATION_URL);
    const dlq = 'notification-service.payment-events.dlq';
    const dlqBefore = await queueDepth(dlq);
    const eventId = randomUUID();
    const event = {
      eventId,
      type: 'payment.confirmed',
      occurredAt: new Date().toISOString(),
      data: {
        paymentId: randomUUID(),
        orderId: `RETRY-${eventId.slice(0, 8)}`,
        customerId: 'CLI-RES',
        customerEmail: 'resiliencia@comprefacil.com.br',
        amount: '10.00',
        currency: 'BRL',
        status: 'SUCCESS',
      },
    };

    compose('stop', 'postgres');
    try {
      const published = await rabbit('/exchanges/%2F/payments.events/publish', {
        method: 'POST',
        body: JSON.stringify({
          properties: { delivery_mode: 2, message_id: eventId },
          routing_key: 'payment.confirmed',
          payload: JSON.stringify(event),
          payload_encoding: 'string',
        }),
      });
      assert.equal(published.body.routed, true);

      await eventually(async () => {
        const depth = await queueDepth(dlq);
        return { done: depth === dlqBefore + 1, value: depth };
      }, 'mensagem na DLQ depois de esgotar as tentativas');

      const attempts = compose('logs', '--no-color', 'notification-service')
        .split('\n')
        .filter((line) => line.includes(eventId) && line.includes('tentativa'));
      assert.equal(attempts.length, 4, '1 entrega + 3 reentregas (x-delivery-limit)');
    } finally {
      compose('start', 'postgres');
    }
    await healthy(NOTIFICATION_URL);
    await healthy(PAYMENT_URL);
  });
});
