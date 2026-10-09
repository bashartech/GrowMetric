import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import { requestMeta, toWorkspaceDTO } from "../auth/auth.types.js";
import type { UpdateWorkspaceInput } from "./workspace.schema.js";
import * as service from "./workspace.service.js";

export const listWorkspacesController = asyncHandler(async (req, res) => {
  const workspaces = await service.listWorkspaces(req.tenant!.organizationId);
  ok(res, { workspaces: workspaces.map(toWorkspaceDTO) });
});

export const getCurrentWorkspaceController = asyncHandler(async (req, res) => {
  const workspace = await service.getCurrentWorkspace(
    req.tenant!.organizationId,
  );
  ok(res, { workspace: toWorkspaceDTO(workspace) });
});

export const updateWorkspaceController = asyncHandler(async (req, res) => {
  const workspace = await service.updateWorkspace(
    req.tenant!.organizationId,
    req.user!.id,
    req.params.id!,
    (req.body as UpdateWorkspaceInput).name,
    requestMeta(req),
  );
  ok(res, { workspace: toWorkspaceDTO(workspace) });
});
