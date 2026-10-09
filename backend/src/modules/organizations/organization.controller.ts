import { asyncHandler } from "../../lib/async-handler.js";
import { ok } from "../../lib/respond.js";
import { requestMeta, toOrganizationDTO } from "../auth/auth.types.js";
import type { UpdateOrganizationInput } from "./organization.schema.js";
import * as service from "./organization.service.js";

export const getCurrentOrganizationController = asyncHandler(
  async (req, res) => {
    const organization = await service.getCurrentOrganization(
      req.tenant!.organizationId,
    );
    ok(res, { organization: toOrganizationDTO(organization) });
  },
);

export const updateCurrentOrganizationController = asyncHandler(
  async (req, res) => {
    const organization = await service.updateCurrentOrganization(
      req.tenant!.organizationId,
      req.user!.id,
      (req.body as UpdateOrganizationInput).name,
      requestMeta(req),
    );
    ok(res, { organization: toOrganizationDTO(organization) });
  },
);
