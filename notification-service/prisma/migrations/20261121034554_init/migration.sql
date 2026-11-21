-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PAYMENT_REQUESTED', 'PAYMENT_CONFIRMED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_event_id_key" ON "notifications"("event_id");

-- CreateIndex
CREATE INDEX "notifications_payment_id_sent_at_idx" ON "notifications"("payment_id", "sent_at");
