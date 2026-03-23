const fs = require("fs/promises");
const path = require("path");

class LskyHttpError extends Error {
  constructor(message, statusCode, payload) {
    super(message);
    this.name = "LskyHttpError";
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

class LskyClient {
  constructor(config) {
    this.config = config;
    this.cachedToken = "";
    this.cookieJar = new Map();
    this.tokenPromise = null;
    this.sessionPromise = null;
    this.storedTokenLoaded = false;
    this.storedToken = "";
    this.ignoreConfiguredAccessToken = false;
  }

  async getPrivateAlbums(query = {}) {
    return this.requestWithAuth({
      apiPath: this.config.lskyApiAlbumsPath,
      sessionPath: this.config.lskyPrivateAlbumsPath,
      query
    });
  }

  async getPrivateImages(query = {}) {
    return this.requestWithAuth({
      apiPath: this.config.lskyApiImagesPath,
      sessionPath: this.config.lskyPrivateImagesPath,
      query
    });
  }

  async getPublicUserAlbums(username, query = {}) {
    if (!this.config.lskyPublicUserAlbumsPath.includes("{username}")) {
      throw new Error(
        "LSKY_PUBLIC_USER_ALBUMS_PATH must contain {username} placeholder."
      );
    }

    const path = this.config.lskyPublicUserAlbumsPath.replace(
      "{username}",
      encodeURIComponent(username)
    );

    return this.request(path, { query });
  }

  async requestWithAuth(options = {}) {
    const { apiPath, sessionPath, query = {} } = options;
    const mode = this.config.authMode;

    if (mode === "session") {
      return this.requestWithSession(sessionPath, { query });
    }

    return this.requestWithApiAuth(apiPath, { query });
  }

  async requestWithApiAuth(path, options = {}) {
    const initialToken = await this.getAccessToken();

    try {
      return await this.request(path, {
        ...options,
        token: initialToken,
        useApiPrefix: true
      });
    } catch (error) {
      const shouldRetry =
        error instanceof LskyHttpError &&
        [401, 403].includes(error.statusCode) &&
        this.canLoginWithCredentials();

      if (!shouldRetry) {
        throw error;
      }

      await this.invalidateAccessToken();
      const refreshedToken = await this.getAccessToken(true);

      return this.request(path, {
        ...options,
        token: refreshedToken,
        useApiPrefix: true
      });
    }
  }

  async requestWithSession(path, options = {}) {
    await this.ensureSession();

    try {
      return await this.request(path, {
        ...options,
        useApiPrefix: false,
        headers: {
          ...(options.headers || {}),
          "X-Requested-With": "XMLHttpRequest"
        }
      });
    } catch (error) {
      const shouldRetry =
        error instanceof LskyHttpError &&
        (
          [200, 302, 401, 403, 419].includes(error.statusCode) ||
          error.message.includes("Expected JSON response")
        );

      if (!shouldRetry) {
        throw error;
      }

      this.cookieJar.clear();
      await this.ensureSession(true);

      return this.request(path, {
        ...options,
        useApiPrefix: false,
        headers: {
          ...(options.headers || {}),
          "X-Requested-With": "XMLHttpRequest"
        }
      });
    }
  }

  async ensureSession(forceRefresh = false) {
    if (!this.config.username || !this.config.password) {
      throw new Error(
        "Session mode requires both LSKY_USERNAME and LSKY_PASSWORD."
      );
    }

    if (!forceRefresh && this.cookieJar.has("lsky_pro_session")) {
      return;
    }

    if (!forceRefresh && this.sessionPromise) {
      return this.sessionPromise;
    }

    this.sessionPromise = this.loginWithSession().finally(() => {
      this.sessionPromise = null;
    });

    return this.sessionPromise;
  }

  async getAccessToken(forceRefresh = false) {
    if (!forceRefresh && this.cachedToken) {
      return this.cachedToken;
    }

    if (!forceRefresh) {
      const configuredToken = this.getConfiguredAccessToken();
      if (configuredToken) {
        this.cachedToken = configuredToken;
        return configuredToken;
      }

      const storedToken = await this.loadStoredToken();
      if (storedToken) {
        this.cachedToken = storedToken;
        return storedToken;
      }
    }

    if (!this.config.username || !this.config.password) {
      throw new Error(
        "Private mode requires a token, a cached token file, or both LSKY_USERNAME and LSKY_PASSWORD."
      );
    }

    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    this.tokenPromise = this.login().finally(() => {
      this.tokenPromise = null;
    });

    return this.tokenPromise;
  }

  async login() {
    const body = {
      password: this.config.password
    };

    body[this.config.apiTokenField] = this.config.username;

    const response = await this.request(this.config.lskyApiTokenPath, {
      method: "POST",
      body,
      useApiPrefix: true
    });

    const token = response?.data?.token;

    if (!token) {
      throw new Error("Lsky login succeeded but no token was returned.");
    }

    await this.storeAccessToken(token);
    return token;
  }

  async loginWithSession() {
    this.cookieJar.clear();

    const loginPage = await this.request(this.config.lskyLoginPagePath, {
      expectJson: false,
      responseType: "text",
      useApiPrefix: false
    });

    const csrfToken = extractHiddenInputValue(loginPage, "_token");

    if (!csrfToken) {
      throw new Error("Unable to extract _token from the Lsky login page.");
    }

    const body = new URLSearchParams();
    body.set("_token", csrfToken);
    body.set(this.config.loginField, this.config.username);
    body.set("password", this.config.password);

    if (this.config.remember) {
      body.set("remember", "on");
    }

    const response = await this.request(this.config.lskySessionLoginPath, {
      method: "POST",
      body: body.toString(),
      bodyType: "form",
      expectJson: false,
      responseType: "text",
      redirect: "manual",
      allowStatuses: [302, 303],
      useApiPrefix: false,
      headers: {
        Referer: `${this.config.lskyBaseUrl}${this.config.lskyLoginPagePath}`
      }
    });

    if (!this.cookieJar.has("lsky_pro_session")) {
      throw new Error(
        "Lsky session login did not return a valid session cookie."
      );
    }

    if (
      typeof response === "string" &&
      response.includes("name=\"email\"") &&
      response.includes("name=\"password\"")
    ) {
      throw new Error("Lsky session login failed. Please verify your credentials.");
    }
  }

  async request(path, options = {}) {
    const {
      method = "GET",
      query = {},
      body,
      token,
      headers: extraHeaders = {},
      expectJson = true,
      responseType = "json",
      bodyType = "json",
      redirect = "follow",
      useApiPrefix = false,
      allowStatuses = []
    } = options;

    const url = this.buildUrl(path, query, useApiPrefix);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    const headers = {
      Accept: expectJson ? "application/json, text/plain, */*" : "*/*",
      ...extraHeaders
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const cookieHeader = this.serializeCookies();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    if (body !== undefined) {
      headers["Content-Type"] =
        bodyType === "form"
          ? "application/x-www-form-urlencoded"
          : "application/json";
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : bodyType === "form"
              ? body
              : JSON.stringify(body),
        signal: controller.signal,
        redirect
      });

      this.storeResponseCookies(response);

      const rawText = await response.text();
      const payload =
        responseType === "text"
          ? rawText
          : rawText
            ? safeParseJson(rawText)
            : null;

      if (!response.ok && !allowStatuses.includes(response.status)) {
        throw new LskyHttpError(
          getErrorMessage(payload, response.status, response.statusText),
          response.status,
          payload
        );
      }

      if (expectJson && isNonJsonPayload(payload)) {
        throw new LskyHttpError(
          "Expected JSON response from Lsky, but received HTML or plain text.",
          response.status,
          payload
        );
      }

      if (hasApplicationError(payload)) {
        throw new LskyHttpError(
          getErrorMessage(payload, response.status, response.statusText),
          response.status,
          payload
        );
      }

      return payload;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(
          `Request to Lsky timed out after ${this.config.requestTimeoutMs}ms.`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  buildUrl(path, query, useApiPrefix) {
    if (/^https?:\/\//i.test(path)) {
      const absoluteUrl = new URL(path);
      Object.entries(query || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") {
          return;
        }

        absoluteUrl.searchParams.set(key, String(value));
      });

      return absoluteUrl;
    }

    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const prefix = useApiPrefix ? this.config.lskyApiPrefix : "";
    const url = new URL(
      `${this.config.lskyBaseUrl}${prefix}${normalizedPath}`
    );

    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => {
          url.searchParams.append(key, String(item));
        });
        return;
      }

      url.searchParams.set(key, String(value));
    });

    return url;
  }

  storeResponseCookies(response) {
    if (typeof response.headers.getSetCookie !== "function") {
      return;
    }

    response.headers.getSetCookie().forEach((cookie) => {
      const [nameValue] = cookie.split(";");
      const separatorIndex = nameValue.indexOf("=");

      if (separatorIndex === -1) {
        return;
      }

      const name = nameValue.slice(0, separatorIndex).trim();
      const value = nameValue.slice(separatorIndex + 1).trim();
      this.cookieJar.set(name, value);
    });
  }

  serializeCookies() {
    if (this.cookieJar.size === 0) {
      return "";
    }

    return Array.from(this.cookieJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  canLoginWithCredentials() {
    return Boolean(this.config.username && this.config.password);
  }

  getConfiguredAccessToken() {
    if (this.ignoreConfiguredAccessToken) {
      return "";
    }

    return this.config.accessToken || "";
  }

  async invalidateAccessToken() {
    this.cachedToken = "";
    this.storedToken = "";
    this.storedTokenLoaded = true;
    this.ignoreConfiguredAccessToken = true;
    await this.clearStoredToken();
  }

  async loadStoredToken() {
    if (this.storedTokenLoaded) {
      return this.storedToken;
    }

    try {
      const raw = await fs.readFile(this.config.tokenStoragePath, "utf8");
      const token = parseStoredToken(raw);
      this.storedToken = token;
      this.storedTokenLoaded = true;
      return token;
    } catch (error) {
      this.storedTokenLoaded = true;
      this.storedToken = "";

      if (error && error.code === "ENOENT") {
        return "";
      }

      console.warn(
        `Unable to read cached Lsky token from ${this.config.tokenStoragePath}: ${error.message}`
      );
      return "";
    }
  }

  async storeAccessToken(token) {
    this.cachedToken = token;
    this.storedToken = token;
    this.storedTokenLoaded = true;

    const payload = JSON.stringify(
      {
        token,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    );

    await fs.mkdir(path.dirname(this.config.tokenStoragePath), {
      recursive: true
    });
    await fs.writeFile(this.config.tokenStoragePath, payload, {
      mode: 0o600
    });
  }

  async clearStoredToken() {
    try {
      await fs.rm(this.config.tokenStoragePath, {
        force: true
      });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return;
      }

      console.warn(
        `Unable to clear cached Lsky token at ${this.config.tokenStoragePath}: ${error.message}`
      );
    }
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return {
      raw: text
    };
  }
}

function parseStoredToken(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return "";
  }

  if (!trimmed.startsWith("{")) {
    return trimmed;
  }

  try {
    const payload = JSON.parse(trimmed);
    return typeof payload?.token === "string" ? payload.token : "";
  } catch (_error) {
    return "";
  }
}

function getErrorMessage(payload, statusCode, statusText) {
  if (payload && typeof payload === "object") {
    if (typeof payload.message === "string" && payload.message) {
      return payload.message;
    }

    if (payload.errors && typeof payload.errors === "object") {
      const firstError = Object.values(payload.errors)[0];
      if (Array.isArray(firstError) && firstError[0]) {
        return firstError[0];
      }
    }
  }

  return `Lsky request failed with ${statusCode} ${statusText}`.trim();
}

function hasApplicationError(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  return payload.status === false || payload.status === "failed";
}

function isNonJsonPayload(payload) {
  return Boolean(payload && typeof payload === "object" && "raw" in payload);
}

function extractHiddenInputValue(html, inputName) {
  if (!html) {
    return "";
  }

  const pattern = new RegExp(
    `name=["']${escapeRegExp(inputName)}["'][^>]*value=["']([^"']+)["']`,
    "i"
  );
  const match = html.match(pattern);
  return match ? match[1] : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  LskyClient,
  LskyHttpError
};
