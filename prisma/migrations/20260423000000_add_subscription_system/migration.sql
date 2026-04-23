-- Add subscription / trial fields to Device
ALTER TABLE "Device" ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Device" ADD COLUMN "trialStartedAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "trialExpiresAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "trialExpireNotifiedAt" TIMESTAMP(3);

-- Create Subscription table (one row per StoreKit 2 originalTransactionId)
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "originalTransactionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "trialStartedAt" TIMESTAMP(3),
    "trialExpiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subscription_originalTransactionId_key" ON "Subscription"("originalTransactionId");

-- Create SubscriptionDevice table (many devices can share one subscription via same Apple ID)
CREATE TABLE "SubscriptionDevice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubscriptionDevice_subscriptionId_deviceId_key" ON "SubscriptionDevice"("subscriptionId", "deviceId");
CREATE INDEX "SubscriptionDevice_deviceId_idx" ON "SubscriptionDevice"("deviceId");
ALTER TABLE "SubscriptionDevice" ADD CONSTRAINT "SubscriptionDevice_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create RedeemCode table (promotional / referral codes)
CREATE TABLE "RedeemCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 30,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RedeemCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RedeemCode_code_key" ON "RedeemCode"("code");

-- Create RedeemCodeUsage table (tracks which device redeemed which code)
CREATE TABLE "RedeemCodeUsage" (
    "id" TEXT NOT NULL,
    "redeemCodeId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "grantedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RedeemCodeUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RedeemCodeUsage_redeemCodeId_deviceId_key" ON "RedeemCodeUsage"("redeemCodeId", "deviceId");
CREATE INDEX "RedeemCodeUsage_deviceId_idx" ON "RedeemCodeUsage"("deviceId");
ALTER TABLE "RedeemCodeUsage" ADD CONSTRAINT "RedeemCodeUsage_redeemCodeId_fkey"
    FOREIGN KEY ("redeemCodeId") REFERENCES "RedeemCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
