import express, {
  type ErrorRequestHandler,
  type Express,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import adminAuthRouter, { requireAdminForWrites } from "./routes/admin-auth";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: process.env.VERCEL === "1" ? "4mb" : "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", adminAuthRouter);
app.use("/api", requireAdminForWrites);
app.use("/api", router);
const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  logger.error({ err }, "API request failed");
  const statusCode =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof err.status === "number" &&
    err.status >= 400 &&
    err.status < 500
      ? err.status
      : 500;
  res.status(statusCode).json({
    error:
      statusCode === 413
        ? "Request body too large."
        : err instanceof Error
          ? err.message
          : "Internal server error",
  });
};

app.use(errorHandler);

export default app;
