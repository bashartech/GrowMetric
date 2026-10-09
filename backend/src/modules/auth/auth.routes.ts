import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { authRateLimiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import {
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController,
} from "./auth.controller.js";
import { loginSchema, registerSchema } from "./auth.schema.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  authRateLimiter,
  validate({ body: registerSchema }),
  registerController,
);
authRouter.post(
  "/login",
  authRateLimiter,
  validate({ body: loginSchema }),
  loginController,
);
authRouter.post("/refresh", refreshController);
authRouter.post("/logout", logoutController);
authRouter.get("/me", requireAuth, meController);
