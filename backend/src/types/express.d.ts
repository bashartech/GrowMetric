import type { AuthUser } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: AuthUser;
      tenant?: {
        organizationId: string;
        workspaceId: string;
      };
    }
  }
}

export {};
