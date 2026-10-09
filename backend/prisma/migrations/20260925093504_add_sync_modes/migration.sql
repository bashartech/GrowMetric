-- AlterTable
ALTER TABLE "DataSourceTable" ADD COLUMN     "syncMode" TEXT NOT NULL DEFAULT 'REPLACE',
ADD COLUMN     "upsertKeyColumnName" TEXT;
