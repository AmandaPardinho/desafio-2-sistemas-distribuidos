import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

const PAYMENT_URL = process.env.PAYMENT_URL ?? 'http://localhost:3000';
const NOTIFICATION_URL = process.env.NOTIFICATION_URL ?? 'http://localhost:3001';
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 30_000);

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

async function eventually(check, description) {
  const deadline = Date.now() + TIMEOUT_MS;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last.done) return last.value;
    await sleep(500);
  }
  assert.fail(
    `Tempo esgotado esperando: ${description} (último valor: ${JSON.stringify(last?.value)})`,
  );
}

function newPayment(overrides = {}) {
  return {
    orderId: `E2E-${randomUUID()}`,
    customerId: 'CLI-E2E',
    customerEmail: 'e2e@comprefacil.com.br',
    amount: 1259.9,
    ...overrides,
  };
}

describe('serviços no ar', () => {
  it('payment-service responde saudável', async () => {
    const { status, body } = await request(`${PAYMENT_URL}/health`);
    assert.equal(status, 200);
    assert.deepEqual(body.dependencies, { database: 'up', broker: 'up' });
  });

  it('notification-service responde saudável', async () => {
    const { status, body } = await request(`${NOTIFICATION_URL}/health`);
    assert.equal(status, 200);
    assert.deepEqual(body.dependencies, { database: 'up', broker: 'up' });
  });
});

describe('fluxo de solicitação de pagamento', () => {
  it('executa os 6 passos do desafio de forma assíncrona', async () => {
    const payload = newPayment();

    const created = await request(`${PAYMENT_URL}/payments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(created.status, 202, 'a solicitação é aceita sem esperar a confirmação');
    assert.equal(
      created.body.status,
      'PENDING',
      'passo I: transação gravada como pendente',
    );
    assert.equal(created.body.amount, '1259.90');
    assert.equal(created.headers.get('location'), `/payments/${created.body.id}`);

    const paymentId = created.body.id;

    const confirmed = await eventually(async () => {
      const { body } = await request(`${PAYMENT_URL}/payments/${paymentId}`);
      return { done: body.status === 'SUCCESS', value: body };
    }, 'status SUCCESS');
    assert.ok(confirmed.confirmedAt, 'passo IV: transação confirmada com data');

    const notifications = await eventually(async () => {
      const { body } = await request(
        `${NOTIFICATION_URL}/notifications?paymentId=${paymentId}`,
      );
      return { done: body.length === 2, value: body };
    }, 'duas notificações');

    assert.deepEqual(
      notifications.map((notification) => notification.type),
      ['PAYMENT_REQUESTED', 'PAYMENT_CONFIRMED'],
      'passos III e VI: notificação de recebimento e depois de confirmação',
    );
    for (const notification of notifications) {
      assert.equal(notification.recipient, payload.customerEmail);
      assert.equal(notification.orderId, payload.orderId);
      assert.match(notification.message, /R\$\s1\.259,90/);
    }
    assert.notEqual(notifications[0].eventId, notifications[1].eventId);
    assert.ok(
      new Date(notifications[0].sentAt) <= new Date(notifications[1].sentAt),
      'o cliente recebe "recebemos" antes de "confirmado"',
    );
  });
});

describe('regras da API de pagamento', () => {
  it('recusa um segundo pagamento para o mesmo pedido', async () => {
    const payload = newPayment();
    const first = await request(`${PAYMENT_URL}/payments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 202);

    const second = await request(`${PAYMENT_URL}/payments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(second.status, 409);
  });

  it('valida o corpo da requisição', async () => {
    const { status, body } = await request(`${PAYMENT_URL}/payments`, {
      method: 'POST',
      body: JSON.stringify(
        newPayment({ amount: -5, customerEmail: 'invalido', extra: true }),
      ),
    });
    assert.equal(status, 400);
    assert.ok(body.message.length >= 3);
  });

  it('responde 404 para pagamento inexistente e 400 para id malformado', async () => {
    assert.equal((await request(`${PAYMENT_URL}/payments/${randomUUID()}`)).status, 404);
    assert.equal((await request(`${PAYMENT_URL}/payments/nao-e-uuid`)).status, 400);
  });

  it('valida o filtro da listagem de notificações', async () => {
    assert.equal(
      (await request(`${NOTIFICATION_URL}/notifications?paymentId=abc`)).status,
      400,
    );
  });
});
