import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import * as service from "./mapping.service.js";
import type {
  BatchSuggestionsInput,
  ListMappingSuggestionsInput,
} from "./mapping.schema.js";

export const listMappingSuggestionsController = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListMappingSuggestionsInput;

  const result = await service.listMappingSuggestions(
    req.user!.organizationId,
    req.user!.workspaceId,
    {
      datasetId: query.datasetId,
      importJobId: query.importJobId,
      status: query.status,
      page: query.page ?? 1,
      perPage: query.perPage ?? 20,
    },
  );

  ok(res, result);
});

export const confirmSuggestionController = asyncHandler(async (req, res) => {
  const result = await service.confirmSuggestion(
    req.user!.organizationId,
    req.user!.workspaceId,
    req.params.id!,
  );

  ok(res, result);
});

export const rejectSuggestionController = asyncHandler(async (req, res) => {
  const result = await service.rejectSuggestion(
    req.user!.organizationId,
    req.user!.workspaceId,
    req.params.id!,
  );

  ok(res, result);
});

export const batchSuggestionsController = asyncHandler(async (req, res) => {
  const results = await service.batchResolve(
    req.user!.organizationId,
    req.user!.workspaceId,
    req.body as BatchSuggestionsInput,
  );

  ok(res, { results });
});