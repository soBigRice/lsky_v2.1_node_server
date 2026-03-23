const dotenv = require("dotenv");

dotenv.config();

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function normalizePath(value, fallback) {
  const input = value || fallback;
  if (!input) {
    return "";
  }

  return input.startsWith("/") ? input : `/${input}`;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config = {
  port: parseInteger(process.env.PORT, 3000),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  authMode: (process.env.LSKY_AUTH_MODE || "auto").toLowerCase(),
  lskyBaseUrl: trimTrailingSlash(process.env.LSKY_BASE_URL || ""),
  lskyApiPrefix: normalizePath(process.env.LSKY_API_PREFIX, "/api/v1"),
  lskyApiTokenPath: normalizePath(
    process.env.LSKY_API_TOKEN_PATH,
    "/tokens"
  ),
  lskyLoginPath: normalizePath(process.env.LSKY_LOGIN_PATH, "/login"),
  lskyLoginPagePath: normalizePath(
    process.env.LSKY_LOGIN_PAGE_PATH,
    "/login"
  ),
  lskySessionLoginPath: normalizePath(
    process.env.LSKY_SESSION_LOGIN_PATH,
    "/login"
  ),
  lskyPrivateAlbumsPath: normalizePath(
    process.env.LSKY_PRIVATE_ALBUMS_PATH,
    "/user/albums"
  ),
  lskyApiAlbumsPath: normalizePath(
    process.env.LSKY_API_PRIVATE_ALBUMS_PATH,
    "/albums"
  ),
  lskyPrivateImagesPath: normalizePath(
    process.env.LSKY_PRIVATE_IMAGES_PATH,
    "/user/images"
  ),
  lskyApiImagesPath: normalizePath(
    process.env.LSKY_API_PRIVATE_IMAGES_PATH,
    "/images"
  ),
  lskyPublicUserAlbumsPath:
    process.env.LSKY_PUBLIC_USER_ALBUMS_PATH || "/explore/users/{username}/albums",
  accessToken: process.env.LSKY_ACCESS_TOKEN || "",
  loginField: process.env.LSKY_LOGIN_FIELD || "email",
  apiTokenField:
    process.env.LSKY_API_TOKEN_FIELD ||
    process.env.LSKY_LOGIN_FIELD ||
    "email",
  loginType: process.env.LSKY_LOGIN_TYPE || "username",
  username: process.env.LSKY_USERNAME || "",
  password: process.env.LSKY_PASSWORD || "",
  remember: parseBoolean(process.env.LSKY_REMEMBER, true),
  loginToken: process.env.LSKY_LOGIN_TOKEN || "",
  requestTimeoutMs: parseInteger(process.env.REQUEST_TIMEOUT_MS, 10000)
};

function assertBaseConfig() {
  if (!config.lskyBaseUrl) {
    throw new Error("Missing LSKY_BASE_URL in environment variables.");
  }
}

function canUsePrivateMode() {
  if (config.authMode === "session") {
    return Boolean(config.username && config.password);
  }

  return Boolean(config.accessToken || (config.username && config.password));
}

module.exports = {
  config,
  assertBaseConfig,
  canUsePrivateMode
};
