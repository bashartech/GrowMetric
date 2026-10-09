-- AlterTable
ALTER TABLE "AlertRule" ADD COLUMN     "datasetId" UUID;

-- AlterTable
ALTER TABLE "EmailDelivery" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

