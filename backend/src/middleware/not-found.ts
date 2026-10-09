import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../lib/http-errors.js";

export const notFoundHandler: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  next(new AppError("NOT_FOUND", `Route ${req.method} ${req.originalUrl} not found`));
};
