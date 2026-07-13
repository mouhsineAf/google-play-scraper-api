import express from "express";
import gplay from "google-play-scraper";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "100kb" }));

function getNumber(value, fallback, minimum = 1, maximum = 100) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, minimum), maximum);
}

function getText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const cleaned = value.trim();
  return cleaned || fallback;
}

function getBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

/*
 * Home page
 */
app.get("/", (request, response) => {
  response.json({
    name: "Google Play Scraper API",
    status: "online",
    endpoints: {
      health: "/health",
      search: "/search?query=calculator&country=us&language=en&limit=10",
      app: "/app/com.google.android.apps.translate?country=us&language=en",
      developer:
        "/developer/5700313618786177705?country=us&language=en&limit=10&includeAppDetails=true"
    }
  });
});

/*
 * Health check
 */
app.get("/health", (request, response) => {
  response.json({
    status: "ok",
    service: "google-play-scraper-api",
    timestamp: new Date().toISOString()
  });
});

/*
 * Search Google Play applications
 *
 * Example:
 * /search?query=calculator&country=us&language=en&limit=10
 */
app.get(
  "/search",
  asyncRoute(async (request, response) => {
    const query = getText(request.query.query || request.query.term);

    if (!query) {
      return response.status(400).json({
        success: false,
        error: "The query parameter is required."
      });
    }

    const country = getText(request.query.country, "us").toLowerCase();
    const language = getText(
      request.query.language || request.query.lang,
      "en"
    ).toLowerCase();

    const limit = getNumber(
      request.query.limit || request.query.num,
      10,
      1,
      100
    );

    const results = await gplay.search({
      term: query,
      num: limit,
      country,
      lang: language,
      throttle: 2
    });

    const apps = results.map((item) => ({
      appId: item.appId ?? null,
      title: item.title ?? null,
      developer: item.developer ?? null,
      developerId: item.developerId ?? null,
      summary: item.summary ?? null,
      rating: item.score ?? null,
      priceText: item.priceText ?? null,
      free: item.free ?? null,
      icon: item.icon ?? null,
      url: item.url ?? null
    }));

    return response.json({
      success: true,
      query,
      country,
      language,
      count: apps.length,
      apps
    });
  })
);

/*
 * Get complete information about one application
 *
 * Example:
 * /app/com.google.android.apps.translate
 */
app.get(
  "/app/:appId",
  asyncRoute(async (request, response) => {
    const appId = getText(request.params.appId);

    if (!appId) {
      return response.status(400).json({
        success: false,
        error: "The application ID is required."
      });
    }

    const country = getText(request.query.country, "us").toLowerCase();
    const language = getText(
      request.query.language || request.query.lang,
      "en"
    ).toLowerCase();

    const application = await gplay.app({
      appId,
      country,
      lang: language,
      throttle: 2
    });

    return response.json({
      success: true,
      country,
      language,
      app: application
    });
  })
);

/*
 * Get applications belonging to a developer
 *
 * Example:
 * /developer/5700313618786177705?includeAppDetails=true
 */
app.get(
  "/developer/:developerId",
  asyncRoute(async (request, response) => {
    const developerId = getText(request.params.developerId);

    if (!developerId) {
      return response.status(400).json({
        success: false,
        error: "The developer ID is required."
      });
    }

    const country = getText(request.query.country, "us").toLowerCase();
    const language = getText(
      request.query.language || request.query.lang,
      "en"
    ).toLowerCase();

    const limit = getNumber(
      request.query.limit || request.query.num,
      20,
      1,
      100
    );

    const includeAppDetails = getBoolean(
      request.query.includeAppDetails,
      false
    );

    const apps = await gplay.developer({
      devId: developerId,
      country,
      lang: language,
      num: limit,
      fullDetail: includeAppDetails,
      throttle: 2
    });

    const firstApp = apps[0] || {};

    return response.json({
      success: true,
      developerId,
      developerName: firstApp.developer ?? null,
      developerEmail: firstApp.developerEmail ?? null,
      developerWebsite: firstApp.developerWebsite ?? null,
      country,
      language,
      visibleAppCount: apps.length,
      includeAppDetails,
      apps
    });
  })
);

/*
 * Unknown endpoint
 */
app.use((request, response) => {
  response.status(404).json({
    success: false,
    error: "Endpoint not found."
  });
});

/*
 * Error handler
 */
app.use((error, request, response, next) => {
  console.error("API error:", error);

  const message =
    error instanceof Error ? error.message : "Unknown server error";

  response.status(500).json({
    success: false,
    error: message,
    timestamp: new Date().toISOString()
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Google Play Scraper API running on port ${port}`);
});
