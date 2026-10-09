import {
  createHmac,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { Router, type IRouter, type RequestHandler } from "express";

const SESSION_COOKIE = "jungle_admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

type AdminConfig = {
  username: string;
  password: string;
  sessionSecret: string;
};

function getAdminConfig(): AdminConfig | undefined {
  const { ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET } = process.env;
  if (
    !ADMIN_USERNAME ||
    !ADMIN_PASSWORD ||
    ADMIN_PASSWORD.length < 12 ||
    !SESSION_SECRET ||
    SESSION_SECRET.length < 32
  ) {
    return undefined;
  }

  return {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
    sessionSecret: SESSION_SECRET,
  };
}

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function createSignature(expiresAt: string, secret: string): string {
  return createHmac("sha256", secret).update(expiresAt).digest("base64url");
}

function getSessionCookie(cookieHeader: string | undefined): string | undefined {
  const prefix = `${SESSION_COOKIE}=`;
  const entry = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return entry?.slice(prefix.length);
}

function isAdminAuthenticated(
  cookieHeader: string | undefined,
  config: AdminConfig,
): boolean {
  const session = getSessionCookie(cookieHeader);
  if (!session) return false;

  const [expiresAt, signature, extra] = session.split(".");
  if (!expiresAt || !signature || extra !== undefined) return false;

  const expiration = Number(expiresAt);
  if (!Number.isSafeInteger(expiration) || expiration <= Date.now() / 1000) {
    return false;
  }

  return secureEqual(signature, createSignature(expiresAt, config.sessionSecret));
}

function unavailable(res: Parameters<RequestHandler>[1]): void {
  res.status(503).json({ error: "Admin authentication is not configured." });
}

const router: IRouter = Router();

router.get("/admin/session", (req, res): void => {
  const config = getAdminConfig();
  res.set("Cache-Control", "no-store");
  if (!config) {
    unavailable(res);
    return;
  }

  res.json({
    authenticated: isAdminAuthenticated(req.headers.cookie, config),
  });
});

router.post("/admin/login", (req, res): void => {
  const config = getAdminConfig();
  res.set("Cache-Control", "no-store");
  if (!config) {
    unavailable(res);
    return;
  }

  const { username, password } = req.body ?? {};
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !secureEqual(username.trim(), config.username) ||
    !secureEqual(password, config.password)
  ) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  const expiresAt = String(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS);
  const signature = createSignature(expiresAt, config.sessionSecret);
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${expiresAt}.${signature}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`,
  );
  res.json({ authenticated: true });
});

router.post("/admin/logout", (_req, res): void => {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure ? "; Secure" : ""}`,
  );
  res.status(204).end();
});

export const requireAdminForWrites: RequestHandler = (req, res, next): void => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }

  const config = getAdminConfig();
  if (!config) {
    unavailable(res);
    return;
  }
  if (!isAdminAuthenticated(req.headers.cookie, config)) {
    res.status(401).json({ error: "Admin authentication required." });
    return;
  }

  next();
};

export default router;
