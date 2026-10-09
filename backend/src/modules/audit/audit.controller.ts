import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import type { AuditQueryInput } from "./audit.schema.js";
import * as service from "./audit.service.js";

export const listAuditLogsController = asyncHandler(async (req, res) => {
  const { page, pageSize, action } = req.query as unknown as AuditQueryInput;

  const result = await service.listAuditLogs(req.tenant!.organizationId, {
    page,
    pageSize,
    action,
  });

  ok(res, result);
});
