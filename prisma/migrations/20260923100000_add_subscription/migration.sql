-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('NEWEBPAY', 'MANUAL');

-- CreateTable
CREATE TABLE "subscription" (
    "firebase_uid" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "plan" TEXT NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "provider_period_no" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("firebase_uid")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_provider_period_no_key" ON "subscription"("provider_period_no");
