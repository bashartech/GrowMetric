-- Add organizationId to EmailDelivery for tenant isolation
ALTER TABLE "EmailDelivery" ADD COLUMN "organizationId" UUID NOT NULL DEFAULT gen_random_uuid();
