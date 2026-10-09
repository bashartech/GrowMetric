-- ReportSchedule.organizationId had no foreign key to Organization, so deleting
-- a tenant left its schedules behind as orphans. The scheduler kept selecting
-- those rows every minute and each insert failed on Job_organizationId_fkey,
-- because Job.organizationId does have a real FK with ON DELETE CASCADE.
--
-- Adding the constraint is only possible once the orphans are gone, so they are
-- removed first. They are unusable by definition: the organization they belong
-- to no longer exists, so the schedule can never enqueue anything again.

DELETE FROM "ReportSchedule" s
WHERE NOT EXISTS (
  SELECT 1 FROM "Organization" o WHERE o.id = s."organizationId"
);

ALTER TABLE "ReportSchedule"
  ADD CONSTRAINT "ReportSchedule_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;