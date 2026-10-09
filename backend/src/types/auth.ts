export interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
  workspaceId: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  org: string;
  ws: string;
}

export interface VerifiedAccessToken extends AccessTokenPayload {
  iat: number;
  exp: number;
}
