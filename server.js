import fs from "node:fs/promises";
import gplay from "google-play-scraper";

const config = {
  keywords: [
    "freefire",
    "calculator",
    "wallpaper",
    "education"
  ],
  country: "us",
  language: "en",

  // Keep numbers low while testing.
  maxResultsPerKeyword: 5,
  maxDevelopersPerRun: 20,
  maxAppsPerDeveloper: 50
};

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseInstallNumber(app) {
  if (Number.isFinite(Number(app.minInstalls))) {
    return Number(app.minInstalls);
  }

  if (typeof app.installs === "string") {
    const cleaned = app.installs.replace(/[^\d]/g, "");
    return Number(cleaned) || 0;
  }

  return 0;
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function differenceInDays(startDate, endDate) {
  const milliseconds = endDate.getTime() - startDate.getTime();
  return Math.floor(milliseconds / 86_400_000);
}

function round(value, decimals = 2) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

async function discoverDevelopers() {
  const developers = new Map();

  for (const keyword of config.keywords) {
    console.log(`Searching keyword: ${keyword}`);

    try {
      const apps = await gplay.search({
        term: keyword,
        num: config.maxResultsPerKeyword,
        country: config.country,
        lang: config.language,
        throttle: 2
      });

      for (const app of apps) {
        if (!app.developerId) {
          continue;
        }

        if (!developers.has(app.developerId)) {
          developers.set(app.developerId, {
            developerId: app.developerId,
            developerName: app.developer ?? null,
            sourceKeywords: []
          });
        }

        const developer = developers.get(app.developerId);

        if (!developer.sourceKeywords.includes(keyword)) {
          developer.sourceKeywords.push(keyword);
        }
      }
    } catch (error) {
      console.error(`Search failed for ${keyword}:`, error.message);
    }

    await sleep(1500);
  }

  return [...developers.values()].slice(
    0,
    config.maxDevelopersPerRun
  );
}

async function analyseDeveloper(discoveredDeveloper) {
  const apps = await gplay.developer({
    devId: discoveredDeveloper.developerId,
    country: config.country,
    lang: config.language,
    num: config.maxAppsPerDeveloper,
    fullDetail: true,
    throttle: 2
  });

  const now = new Date();

  const releaseDates = apps
    .map((app) => parseDate(app.released))
    .filter(Boolean);

  const updateDates = apps
    .map((app) => parseDate(app.updated))
    .filter(Boolean);

  const earliestReleaseDate =
    releaseDates.length > 0
      ? new Date(Math.min(...releaseDates.map((date) => date.getTime())))
      : null;

  const latestUpdateDate =
    updateDates.length > 0
      ? new Date(Math.max(...updateDates.map((date) => date.getTime())))
      : null;

  const installs = apps.map(parseInstallNumber);

  const totalMinimumInstalls = installs.reduce(
    (total, value) => total + value,
    0
  );

  const ratings = apps
    .map((app) => Number(app.score))
    .filter((value) => Number.isFinite(value) && value > 0);

  const averageRating =
    ratings.length > 0
      ? ratings.reduce((total, value) => total + value, 0) /
        ratings.length
      : null;

  const firstApp = apps[0] ?? {};

  const appsWithReleaseDates = releaseDates.length;

  let ageConfidence = "low";

  if (apps.length > 0 && appsWithReleaseDates === apps.length) {
    ageConfidence = "high";
  } else if (appsWithReleaseDates > 0) {
    ageConfidence = "medium";
  }

  return {
    developerId: discoveredDeveloper.developerId,
    developerName:
      firstApp.developer ??
      discoveredDeveloper.developerName ??
      null,

    developerEmail: firstApp.developerEmail ?? null,
    developerWebsite: firstApp.developerWebsite ?? null,

    sourceKeywords: discoveredDeveloper.sourceKeywords,

    visibleAppCount: apps.length,
    totalMinimumInstalls,

    averageMinimumInstalls:
      apps.length > 0
        ? Math.round(totalMinimumInstalls / apps.length)
        : 0,

    earliestVisibleReleaseDate:
      earliestReleaseDate?.toISOString() ?? null,

    estimatedAccountAgeYears:
      earliestReleaseDate
        ? round(differenceInDays(earliestReleaseDate, now) / 365.25)
        : null,

    ageConfidence,

    latestAppUpdateDate:
      latestUpdateDate?.toISOString() ?? null,

    daysSinceLatestUpdate:
      latestUpdateDate
        ? differenceInDays(latestUpdateDate, now)
        : null,

    averageRating:
      averageRating === null ? null : round(averageRating),

    hasDeveloperEmail: Boolean(firstApp.developerEmail),
    hasDeveloperWebsite: Boolean(firstApp.developerWebsite),

    apps: apps.map((app) => ({
      appId: app.appId ?? null,
      title: app.title ?? null,
      minInstalls: parseInstallNumber(app),
      installRange: app.installs ?? null,
      rating: app.score ?? null,
      ratingsCount: app.ratings ?? null,
      released: app.released ?? null,
      updated: app.updated ?? null,
      category: app.genre ?? null,
      privacyPolicy: app.privacyPolicy ?? null,
      url: app.url ?? null
    }))
  };
}

async function main() {
  const discoveredDevelopers = await discoverDevelopers();

  console.log(
    `Found ${discoveredDevelopers.length} unique developers`
  );

  const developers = [];
  const errors = [];

  for (const developer of discoveredDevelopers) {
    console.log(
      `Analysing developer: ${developer.developerName ?? developer.developerId}`
    );

    try {
      const result = await analyseDeveloper(developer);
      developers.push(result);
    } catch (error) {
      errors.push({
        developerId: developer.developerId,
        developerName: developer.developerName,
        error: error.message
      });

      console.error(
        `Developer failed: ${developer.developerId}`,
        error.message
      );
    }

    await sleep(2000);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    configuration: config,
    summary: {
      discoveredDevelopers: discoveredDevelopers.length,
      analysedDevelopers: developers.length,
      failedDevelopers: errors.length
    },
    developers,
    errors
  };

  await fs.mkdir("data", { recursive: true });

  await fs.writeFile(
    "data/results.json",
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log("Saved data/results.json");
}

main().catch((error) => {
  console.error("Fatal scraper error:", error);
  process.exit(1);
});
