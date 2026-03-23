const express = require("express");
const {
  config,
  assertBaseConfig,
  canUsePrivateMode
} = require("./config");
const { LskyClient, LskyHttpError } = require("./lsky-client");

assertBaseConfig();

const app = express();
const lskyClient = new LskyClient(config);

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", config.corsOrigin);
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    service: "lsky-album-proxy",
    time: new Date().toISOString()
  });
});

app.get("/api/albums", async (req, res, next) => {
  try {
    if (!canUsePrivateMode()) {
      return res.status(500).json({
        success: false,
        message:
          "Private mode is not configured. Set LSKY_ACCESS_TOKEN, provide a cached token file, or set LSKY_USERNAME/LSKY_PASSWORD."
      });
    }

    const payload = await lskyClient.getPrivateAlbums(filterQuery(req.query));

    return res.json(formatAlbumResponse(payload, {
      mode: "private",
      raw: req.query.raw === "1"
    }));
  } catch (error) {
    return next(error);
  }
});

app.get("/api/images", async (req, res, next) => {
  try {
    if (!canUsePrivateMode()) {
      return res.status(500).json({
        success: false,
        message:
          "Private mode is not configured. Set LSKY_ACCESS_TOKEN, provide a cached token file, or set LSKY_USERNAME/LSKY_PASSWORD."
      });
    }

    const payload = await lskyClient.getPrivateImages(filterQuery(req.query));

    return res.json(formatImageResponse(payload, {
      mode: "private",
      raw: req.query.raw === "1"
    }));
  } catch (error) {
    return next(error);
  }
});

app.get("/api/albums/:albumId/images", async (req, res, next) => {
  try {
    if (!canUsePrivateMode()) {
      return res.status(500).json({
        success: false,
        message:
          "Private mode is not configured. Set LSKY_ACCESS_TOKEN, provide a cached token file, or set LSKY_USERNAME/LSKY_PASSWORD."
      });
    }

    const payload = await lskyClient.getPrivateImages({
      ...filterQuery(req.query),
      album_id: req.params.albumId
    });

    return res.json(formatImageResponse(payload, {
      mode: "private",
      albumId: req.params.albumId,
      raw: req.query.raw === "1"
    }));
  } catch (error) {
    return next(error);
  }
});

app.get("/api/public/users/:username/albums", async (req, res, next) => {
  try {
    const payload = await lskyClient.getPublicUserAlbums(
      req.params.username,
      filterQuery(req.query)
    );

    return res.json(formatAlbumResponse(payload, {
      mode: "public",
      username: req.params.username,
      raw: req.query.raw === "1"
    }));
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof LskyHttpError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      details: error.payload || null
    });
  }

  return res.status(500).json({
    success: false,
    message: error.message || "Unknown server error"
  });
});

app.listen(config.port, () => {
  console.log(`lsky-album-proxy is listening on port ${config.port}`);
});

function filterQuery(query) {
  const nextQuery = { ...query };
  delete nextQuery.raw;
  return nextQuery;
}

function formatAlbumResponse(payload, options = {}) {
  const pageData = payload?.data?.albums ?? payload?.data ?? {};
  const items = Array.isArray(pageData.data)
    ? pageData.data
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  const pagination = extractPagination(pageData);
  const response = {
    success: true,
    mode: options.mode,
    message: payload?.message || "ok",
    items,
    pagination
  };

  if (options.username) {
    response.username = options.username;
  }

  if (options.raw) {
    response.raw = payload;
  }

  return response;
}

function formatImageResponse(payload, options = {}) {
  const pageData = payload?.data?.images ?? payload?.data ?? {};
  const items = Array.isArray(pageData.data)
    ? pageData.data
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  const response = {
    success: true,
    mode: options.mode,
    message: payload?.message || "ok",
    items,
    pagination: extractPagination(pageData)
  };

  if (options.albumId) {
    response.albumId = options.albumId;
  }

  if (options.raw) {
    response.raw = payload;
  }

  return response;
}

function extractPagination(pageData) {
  if (!pageData || typeof pageData !== "object") {
    return null;
  }

  if (!("current_page" in pageData) && !("last_page" in pageData)) {
    return null;
  }

  return {
    currentPage: pageData.current_page ?? null,
    perPage: toNumberOrNull(pageData.per_page),
    total: toNumberOrNull(pageData.total),
    from: toNumberOrNull(pageData.from),
    to: toNumberOrNull(pageData.to),
    lastPage: toNumberOrNull(pageData.last_page),
    nextPageUrl: pageData.next_page_url ?? null,
    prevPageUrl: pageData.prev_page_url ?? null
  };
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
