import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const requestId: RequestHandler = (req, res, next) => {
  const header = req.headers["x-request-id"];
  req.id =
    typeof header === "string" && header.trim().length > 0
      ? header.trim()
      : randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
};
