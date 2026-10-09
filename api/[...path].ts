import app from "../artifacts/api-server/src/app";
import { initializeMenuData } from "../artifacts/api-server/src/routes/menu";
import { logger } from "../artifacts/api-server/src/lib/logger";

type ApiRequest = Parameters<typeof app>[0];
type ApiResponse = Parameters<typeof app>[1];

let initialization: Promise<void> | undefined;

export default async function handler(
  req: ApiRequest,
  res: ApiResponse,
): Promise<void> {
  initialization ??= initializeMenuData();

  try {
    await initialization;
  } catch (error) {
    initialization = undefined;
    logger.error({ err: error }, "Database initialization failed");
    res.status(500).json({ error: "Database initialization failed." });
    return;
  }

  app(req, res);
}
