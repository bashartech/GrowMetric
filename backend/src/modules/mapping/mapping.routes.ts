import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { tenantGuard } from "../../middleware/tenant-guard.js";
import { requireEntitlement } from "../entitlements/entitlement.middleware.js";
import { validate } from "../../middleware/validate.js";
import {
  batchSuggestionsSchema,
  listMappingSuggestionsSchema,
  suggestionIdParamsSchema,
} from "./mapping.schema.js";
import {
  batchSuggestionsController,
  confirmSuggestionController,
  listMappingSuggestionsController,
  rejectSuggestionController,
} from "./mapping.controller.js";

export const mappingRouter = Router();

mappingRouter.use(requireAuth);
mappingRouter.use(tenantGuard);
mappingRouter.use(requireEntitlement("aiConversations"));

mappingRouter.get(
  "/mapping-suggestions",
  validate({ query: listMappingSuggestionsSchema }),
  listMappingSuggestionsController,
);

mappingRouter.post(
  "/mapping-suggestions/batch",
  validate({ body: batchSuggestionsSchema }),
  batchSuggestionsController,
);

mappingRouter.post(
  "/mapping-suggestions/:id/confirm",
  validate({ params: suggestionIdParamsSchema }),
  confirmSuggestionController,
);

mappingRouter.post(
  "/mapping-suggestions/:id/reject",
  validate({ params: suggestionIdParamsSchema }),
  rejectSuggestionController,
);