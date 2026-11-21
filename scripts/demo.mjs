import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const PAYMENT_URL = process.env.PAYMENT_URL ?? 'http://localhost:3000';
const NOTIFICATION_URL = process.env.NOTIFICATION_URL ?? 'http://localhost:3001';
const TIMEOUT_MS = 30_000;

const bold = (text) => `\x1b[1m${text}\x1b[0m`;
const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;

async function getJson(url, options) {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
}

async function main() {
  const started = Date.now();
  const elapsed = () => dim(`+${((Date.now() - started) / 1000).toFixed(1)}s`);
  const payload = {
    orderId: `DEMO-${randomUUID().slice(0, 8).toUpperCase()}`,
    customerId: 'CLI-42',
    customerEmail: 'cliente@comprefacil.com.br',
    amount: 259.9,
  };

  console.log(bold('\nCompreFácil: demonstração do fluxo de pagamento\n'));
  console.log(`${bold('1.')} POST ${PAYMENT_URL}/payments`);
  console.log(dim(`   ${JSON.stringify(payload)}`));

  const created = await getJson(`${PAYMENT_URL}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (created.status !== 202) {
    throw new Error(
      `Resposta inesperada (${created.status}): ${JSON.stringify(created.body)}`,
    );
  }
  const { id } = created.body;
  console.log(
    `   ${created.status} Accepted, status ${yellow(created.body.status)} ${elapsed()}`,
  );
  console.log(dim(`   pagamento ${id}`));

  console.log(
    `\n${bold('2.')} Acompanhando GET /payments/${id.slice(0, 8)}… e GET /notifications`,
  );
  const seen = new Set();
  let status = created.body.status;
  let notificationDownWarned = false;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const [payment, notifications] = await Promise.all([
      getJson(`${PAYMENT_URL}/payments/${id}`),
      getJson(`${NOTIFICATION_URL}/notifications?paymentId=${id}`).catch(() => {
        if (!notificationDownWarned) {
          console.log(
            `   ${yellow('notification-service fora do ar')}: os eventos esperam na fila`,
          );
          notificationDownWarned = true;
        }
        return { status: 0, body: [] };
      }),
    ]);

    if (payment.body.status !== status) {
      console.log(
        `   status ${yellow(status)} → ${green(payment.body.status)} ${elapsed()}`,
      );
      status = payment.body.status;
    }
    for (const notification of notifications.body) {
      if (seen.has(notification.id)) continue;
      seen.add(notification.id);
      console.log(
        `   ${green('e-mail')} ${notification.type} para ${notification.recipient} ${elapsed()}`,
      );
      console.log(dim(`          ${notification.subject}`));
    }
    if (status === 'SUCCESS' && seen.size === 2) break;
    await sleep(300);
  }

  if (status !== 'SUCCESS' || seen.size !== 2) {
    throw new Error(
      'O fluxo não terminou no tempo esperado; confira os logs com docker compose logs',
    );
  }
  console.log(
    `\n${green(bold('Fluxo concluído:'))} pagamento confirmado e cliente notificado duas vezes.\n`,
  );
}

main().catch((error) => {
  console.error(`\n\x1b[31mFalha na demonstração:\x1b[0m ${error.message}\n`);
  process.exit(1);
});
