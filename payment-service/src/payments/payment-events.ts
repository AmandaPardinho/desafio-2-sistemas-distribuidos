import { randomUUID } from 'node:crypto';
import type { Payment } from '@prisma/client';

export const PaymentEventType = {
  REQUESTED: 'payment.requested',
  CONFIRMED: 'payment.confirmed',
} as const;

export type PaymentEventType = (typeof PaymentEventType)[keyof typeof PaymentEventType];

export interface PaymentEventData {
  paymentId: string;
  orderId: string;
  customerId: string;
  customerEmail: string;
  amount: string;
  currency: string;
  status: Payment['status'];
}

export interface PaymentEvent {
  eventId: string;
  type: PaymentEventType;
  occurredAt: string;
  data: PaymentEventData;
}

export function buildPaymentEvent(
  type: PaymentEventType,
  payment: Payment,
  eventId: string = randomUUID(),
  occurredAt: Date = new Date(),
): PaymentEvent {
  return {
    eventId,
    type,
    occurredAt: occurredAt.toISOString(),
    data: {
      paymentId: payment.id,
      orderId: payment.orderId,
      customerId: payment.customerId,
      customerEmail: payment.customerEmail,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      status: payment.status,
    },
  };
}

const expectedStatus: Record<PaymentEventType, Payment['status']> = {
  [PaymentEventType.REQUESTED]: 'PENDING',
  [PaymentEventType.CONFIRMED]: 'SUCCESS',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AMOUNT_PATTERN = /^\d{1,10}\.\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function parsePaymentEvent(content: Buffer): PaymentEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.data)) return null;

  const { eventId, type, occurredAt, data } = parsed;
  if (!isUuid(eventId) || !isIsoDate(occurredAt)) return null;
  if (type !== PaymentEventType.REQUESTED && type !== PaymentEventType.CONFIRMED)
    return null;
  if (!isUuid(data.paymentId) || data.status !== expectedStatus[type]) return null;
  if (!isBoundedString(data.orderId) || !isBoundedString(data.customerId)) return null;
  if (!isEmail(data.customerEmail)) return null;
  if (typeof data.amount !== 'string' || !AMOUNT_PATTERN.test(data.amount)) return null;
  if (Number(data.amount) <= 0) return null;
  if (typeof data.currency !== 'string' || !CURRENCY_PATTERN.test(data.currency))
    return null;

  return parsed as unknown as PaymentEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isEmail(value: unknown): value is string {
  return isBoundedString(value, 254) && EMAIL_PATTERN.test(value);
}

function isBoundedString(value: unknown, max = 64): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
