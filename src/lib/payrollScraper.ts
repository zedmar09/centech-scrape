export type PayrollScraperSource = "fetch" | "playwright" | "flexepos";

export type PayrollScraperConfig = {
  source: PayrollScraperSource;
  urlTemplate: string | null;
  readySelector: string;
  timeoutMs: number;
  headers: Record<string, string>;
};

type PayrollScraperEnv = Record<string, string | undefined>;

type PlaywrightBrowser = {
  close: () => Promise<void>;
  newPage: (options?: {
    extraHTTPHeaders?: Record<string, string>;
  }) => Promise<PlaywrightPage>;
};

type PlaywrightPage = {
  content: () => Promise<string>;
  goto: (
    url: string,
    options?: { timeout?: number; waitUntil?: "domcontentloaded" | "load" | "networkidle" },
  ) => Promise<unknown>;
  waitForSelector: (
    selector: string,
    options?: { timeout?: number },
  ) => Promise<unknown>;
};

type PlaywrightModule = {
  chromium: {
    launch: (options?: { headless?: boolean }) => Promise<PlaywrightBrowser>;
  };
};

export function createPayrollScraperConfig(
  env: PayrollScraperEnv = process.env,
): PayrollScraperConfig {
  return {
    source: readScraperSource(env.PAYROLL_SCRAPER_SOURCE),
    urlTemplate: env.PAYROLL_SCRAPER_URL_TEMPLATE?.trim() || null,
    readySelector: env.PAYROLL_SCRAPER_READY_SELECTOR?.trim() || "table",
    timeoutMs: readPositiveInteger(env.PAYROLL_SCRAPER_TIMEOUT_MS, 30_000),
    headers: createScraperHeaders(env),
  };
}

export async function scrapeStorePayrollHtml(
  storeNumber: string,
  config = createPayrollScraperConfig(),
): Promise<string> {
  if (config.source === "flexepos") {
    throw new Error(
      "Flexepos scraping uses the full login flow. Start it through /api/scrape-runs instead of scrapeStorePayrollHtml.",
    );
  }

  if (config.source === "playwright") {
    return scrapeStoreWithPlaywright(storeNumber, config);
  }

  return scrapeStoreWithFetch(storeNumber, config);
}

export function buildPayrollStoreUrl(urlTemplate: string, storeNumber: string) {
  if (!urlTemplate.includes("{storeNumber}")) {
    throw new Error(
      "PAYROLL_SCRAPER_URL_TEMPLATE must include {storeNumber} so each store can be scraped.",
    );
  }

  return urlTemplate.replaceAll("{storeNumber}", encodeURIComponent(storeNumber));
}

async function scrapeStoreWithFetch(
  storeNumber: string,
  config: PayrollScraperConfig,
) {
  const url = requireStoreUrl(storeNumber, config);
  const response = await fetch(url, {
    cache: "no-store",
    headers: config.headers,
  });

  if (!response.ok) {
    throw new Error(
      `Payroll site returned ${response.status} while scraping store ${storeNumber}.`,
    );
  }

  return response.text();
}

async function scrapeStoreWithPlaywright(
  storeNumber: string,
  config: PayrollScraperConfig,
) {
  const url = requireStoreUrl(storeNumber, config);
  const { chromium } = await importPlaywright();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      extraHTTPHeaders: config.headers,
    });

    await page.goto(url, {
      timeout: config.timeoutMs,
      waitUntil: "networkidle",
    });
    await page.waitForSelector(config.readySelector, {
      timeout: config.timeoutMs,
    });

    return page.content();
  } finally {
    await browser.close();
  }
}

async function importPlaywright(): Promise<PlaywrightModule> {
  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<unknown>;
    const playwrightModule = await dynamicImport("playwright");

    return playwrightModule as PlaywrightModule;
  } catch (caught) {
    const cause = caught instanceof Error ? ` ${caught.message}` : "";

    throw new Error(
      `Playwright is not available in this deployment.${cause} Install and configure Playwright or set PAYROLL_SCRAPER_SOURCE=fetch for static HTML pages.`,
    );
  }
}

function requireStoreUrl(storeNumber: string, config: PayrollScraperConfig) {
  if (!config.urlTemplate) {
    throw new Error(
      "Set PAYROLL_SCRAPER_URL_TEMPLATE before starting a scrape run.",
    );
  }

  return buildPayrollStoreUrl(config.urlTemplate, storeNumber);
}

function createScraperHeaders(env: PayrollScraperEnv) {
  const headers = parseHeadersJson(env.PAYROLL_SCRAPER_HEADERS_JSON);
  const cookie = env.PAYROLL_SCRAPER_COOKIE?.trim();

  if (cookie) {
    headers.cookie = cookie;
  }

  return headers;
}

function parseHeadersJson(value: string | undefined) {
  if (!value?.trim()) {
    return {};
  }

  const parsed = JSON.parse(value) as Record<string, unknown>;
  const headers: Record<string, string> = {};

  for (const [key, headerValue] of Object.entries(parsed)) {
    if (typeof headerValue === "string") {
      headers[key.toLowerCase()] = headerValue;
    }
  }

  return headers;
}

function readScraperSource(value: string | undefined): PayrollScraperSource {
  switch (value) {
    case "fetch":
    case "flexepos":
      return value;
    default:
      return "flexepos";
  }
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
