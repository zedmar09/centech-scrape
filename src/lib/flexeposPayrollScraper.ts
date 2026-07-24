import flexeposConfig from "../config/flexepos.config.json";
import {
  type FlexeposReportType,
  type ScrapeParseResult,
  combineScrapeParseResults,
  getFlexeposReportTarget,
  parseFlexeposReportType,
} from "./reportTypes";
import { parsePayrollHtmlOnServer } from "./serverPayrollParser";
import { parseTipBreakdownHtmlOnServer } from "./serverTipBreakdownParser";
import {
  PayrollScrapeRun,
  PayrollScrapeStoreResult,
  normalizeStoreNumbers,
} from "./scrapeRuns";

export const DEFAULT_FLEXEPOS_STORE_NUMBERS = flexeposConfig.storeNumbers;

export type FlexeposPayrollConfig = {
  baseUrl: string;
  browserWsEndpoint: string | null;
  connectMode: "cdp" | "playwright";
  endDate: string | null;
  headless: boolean;
  includeOvertime: boolean;
  loginPath: string;
  loggedInSelector: string;
  navigationRetries: number;
  navigationTimeoutMs: number;
  navigationWaitUntil: LoadState;
  password: string | null;
  payrollLinkText: string;
  reportLinkText: string;
  reportType: FlexeposReportType;
  requiresRemoteBrowser: boolean;
  selectors: FlexeposPayrollSelectors;
  startDate: string | null;
  stores: string[];
  submitWaitAfterMs: number;
  timeoutMs: number;
  username: string | null;
  waitAfterActionMs: number;
  waitBeforeActionMs: number;
};

export type FlexeposPayrollSelectors = {
  username: string;
  password: string;
  loginSubmit: string;
  store: string;
  startDate: string;
  endDate: string;
  overtime: string;
  submit: string;
  payrollTable: string;
};

export type RunFlexeposPayrollScrapeInput = {
  stores?: string[];
  config?: FlexeposPayrollConfig;
  createRunId?: () => string;
  now?: () => Date;
};

type PayrollScraperEnv = Record<string, string | undefined>;
type FlexeposPayrollConfigOverrides = {
  endDate?: string | null;
  reportType?: unknown;
  startDate?: string | null;
};
type LoadState = "commit" | "domcontentloaded" | "load" | "networkidle";

type BrowserModule = {
  chromium: {
    connect: (endpoint: string) => Promise<Browser>;
    connectOverCDP: (endpoint: string) => Promise<Browser>;
    launch: (options: { headless: boolean }) => Promise<Browser>;
  };
};

export type Browser = {
  close: () => Promise<void>;
  newContext: (options: BrowserContextOptions) => Promise<BrowserContext>;
};

type BrowserContextOptions = {
  ignoreHTTPSErrors?: boolean;
  storageState?: unknown;
  userAgent?: string;
  viewport?: {
    width: number;
    height: number;
  };
};

type BrowserContext = {
  close: () => Promise<void>;
  newPage: () => Promise<Page>;
};

export type Page = {
  content: () => Promise<string>;
  evaluate: <TResult, TArg>(
    pageFunction: (arg: TArg) => TResult,
    arg: TArg,
  ) => Promise<TResult>;
  goto: (
    url: string,
    options?: { timeout?: number; waitUntil?: LoadState },
  ) => Promise<unknown>;
  locator: (selector: string) => Locator;
  setDefaultNavigationTimeout: (timeoutMs: number) => void;
  setDefaultTimeout: (timeoutMs: number) => void;
  url: () => string;
  waitForTimeout: (timeoutMs: number) => Promise<void>;
  waitForLoadState: (state?: LoadState) => Promise<void>;
};

type Locator = {
  check: () => Promise<void>;
  click: () => Promise<void>;
  fill: (value: string) => Promise<void>;
  first: () => Locator;
  inputValue: () => Promise<string>;
  isVisible: (options?: { timeout?: number }) => Promise<boolean>;
  waitFor: (options: { state: "visible"; timeout?: number }) => Promise<void>;
};

type FlexeposStoreWorkResult = {
  parseResult?: ScrapeParseResult;
  storeResult: PayrollScrapeStoreResult;
};

export function createFlexeposPayrollConfig(
  env: PayrollScraperEnv = process.env,
  overrides: FlexeposPayrollConfigOverrides = {},
): FlexeposPayrollConfig {
  const configuredStores = splitStoreNumbers(env.STORE_NUMBERS);
  const reportType = parseFlexeposReportType(overrides.reportType);
  const reportTarget = getFlexeposReportTarget(reportType);
  const reportConfig =
    reportType === "payroll"
      ? flexeposConfig.reports.payroll
      : flexeposConfig.reports.tipBreakdown;
  const configuredSubmitWaitAfterMs =
    "submitWaitAfterMs" in reportConfig &&
    typeof reportConfig.submitWaitAfterMs === "number"
      ? reportConfig.submitWaitAfterMs
      : undefined;
  const waitAfterActionMs = readPositiveInteger(
    env.FLEXEPOS_WAIT_AFTER_ACTION_MS,
    flexeposConfig.timeouts.waitAfterActionMs,
  );
  const reportLinkText =
    reportType === "payroll"
      ? env.FLEXEPOS_PAYROLL_LINK_TEXT?.trim() || reportConfig.linkText
      : env.FLEXEPOS_TIP_BREAKDOWN_LINK_TEXT?.trim() ||
        reportConfig.linkText;

  return {
    baseUrl: env.FLEXEPOS_BASE_URL?.trim() || flexeposConfig.baseUrl,
    browserWsEndpoint: env.FLEXEPOS_PLAYWRIGHT_WS_ENDPOINT?.trim() || null,
    connectMode: readConnectMode(
      env.FLEXEPOS_PLAYWRIGHT_CONNECT_MODE,
      flexeposConfig.playwright.connectMode,
    ),
    endDate: normalizePayrollDateInput(overrides.endDate),
    headless: readBoolean(env.FLEXEPOS_HEADLESS, flexeposConfig.headless),
    includeOvertime: reportConfig.includeOvertime ?? reportTarget.includeOvertime,
    loginPath: env.FLEXEPOS_LOGIN_PATH?.trim() || flexeposConfig.loginPath,
    loggedInSelector:
      env.FLEXEPOS_LOGGED_IN_SELECTOR?.trim() ||
      flexeposConfig.loggedInSelector,
    navigationRetries: readPositiveInteger(
      env.FLEXEPOS_NAVIGATION_RETRIES,
      flexeposConfig.navigation.retries,
    ),
    navigationTimeoutMs: readPositiveInteger(
      env.FLEXEPOS_NAVIGATION_TIMEOUT_MS,
      flexeposConfig.navigation.timeoutMs,
    ),
    navigationWaitUntil: readLoadState(
      env.FLEXEPOS_NAVIGATION_WAIT_UNTIL ?? flexeposConfig.navigation.waitUntil,
    ),
    password: env.FMS_PASSWORD || null,
    payrollLinkText:
      env.FLEXEPOS_PAYROLL_LINK_TEXT?.trim() ||
      flexeposConfig.reports.payroll.linkText,
    reportLinkText,
    reportType,
    requiresRemoteBrowser: env.VERCEL === "1" || env.VERCEL === "true",
    selectors: {
      username:
        env.FLEXEPOS_USERNAME_SELECTOR?.trim() || flexeposConfig.selectors.username,
      password:
        env.FLEXEPOS_PASSWORD_SELECTOR?.trim() || flexeposConfig.selectors.password,
      loginSubmit:
        env.FLEXEPOS_LOGIN_SUBMIT_SELECTOR?.trim() ||
        flexeposConfig.selectors.loginSubmit,
      store:
        env.FLEXEPOS_STORE_SELECTOR?.trim() ||
        flexeposConfig.selectors.store,
      startDate:
        env.FLEXEPOS_START_DATE_SELECTOR?.trim() ||
        flexeposConfig.selectors.startDate,
      endDate:
        env.FLEXEPOS_END_DATE_SELECTOR?.trim() ||
        flexeposConfig.selectors.endDate,
      overtime:
        env.FLEXEPOS_OVERTIME_SELECTOR?.trim() ||
        flexeposConfig.selectors.overtime,
      submit:
        env.FLEXEPOS_SUBMIT_SELECTOR?.trim() || flexeposConfig.selectors.submit,
      payrollTable:
        env.FLEXEPOS_PAYROLL_TABLE_SELECTOR?.trim() ||
        flexeposConfig.selectors.table,
    },
    startDate: normalizePayrollDateInput(overrides.startDate),
    stores: normalizeStoreNumbers(
      configuredStores.length > 0 ? configuredStores : DEFAULT_FLEXEPOS_STORE_NUMBERS,
    ),
    submitWaitAfterMs: readPositiveInteger(
      reportType === "tip-breakdown-report"
        ? env.FLEXEPOS_TIP_BREAKDOWN_SUBMIT_WAIT_AFTER_MS ??
            env.FLEXEPOS_SUBMIT_WAIT_AFTER_MS
        : env.FLEXEPOS_SUBMIT_WAIT_AFTER_MS,
      configuredSubmitWaitAfterMs ??
        reportTarget.submitWaitAfterMs ??
        waitAfterActionMs,
    ),
    timeoutMs: readPositiveInteger(
      env.FLEXEPOS_TIMEOUT_MS,
      flexeposConfig.timeouts.defaultMs,
    ),
    username: env.FMS_USERNAME?.trim() || null,
    waitAfterActionMs,
    waitBeforeActionMs: readPositiveInteger(
      env.FLEXEPOS_WAIT_BEFORE_ACTION_MS,
      flexeposConfig.timeouts.waitBeforeActionMs,
    ),
  };
}

export function resolveRequestedStores(
  requestStores: string[],
  config: FlexeposPayrollConfig,
) {
  const stores = normalizeStoreNumbers(requestStores);

  return stores.length > 0 ? stores : config.stores;
}

export async function runFlexeposPayrollScrape({
  stores = [],
  config = createFlexeposPayrollConfig(),
  createRunId = createDefaultRunId,
  now = () => new Date(),
}: RunFlexeposPayrollScrapeInput): Promise<PayrollScrapeRun> {
  const selectedStores = resolveRequestedStores(stores, config);

  validateFlexeposConfig(config, selectedStores);

  const startedAt = now().toISOString();
  const browser = await createBrowser(config);

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: false,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);
    page.setDefaultNavigationTimeout(config.navigationTimeoutMs);

    await ensureAuthenticated(page, config);
    const reportUrl = await findReportUrl(page, config);
    const storeResults: PayrollScrapeStoreResult[] = [];
    const parseResults: ScrapeParseResult[] = [];

    for (const storeNumber of selectedStores) {
      const storeRun = await scrapeFlexeposStore(page, config, reportUrl, storeNumber);
      storeResults.push(storeRun.storeResult);

      if (storeRun.parseResult) {
        parseResults.push(storeRun.parseResult);
      }
    }

    const hasErrors = storeResults.some((storeResult) => storeResult.status === "error");

    return {
      report_type: config.reportType,
      run_id: createRunId(),
      status: hasErrors ? "completed_with_errors" : "done",
      started_at: startedAt,
      finished_at: now().toISOString(),
      store_results: storeResults,
      result: combineScrapeParseResults(parseResults),
    };
  } finally {
    await browser.close();
  }
}

async function scrapeFlexeposStore(
  page: Page,
  config: FlexeposPayrollConfig,
  reportUrl: string,
  storeNumber: string,
): Promise<FlexeposStoreWorkResult> {
  try {
    await gotoWithRetry(page, reportUrl, config);
    await pause(page, config.waitBeforeActionMs);
    await page.locator(config.selectors.store).first().fill(storeNumber);
    await pause(page, config.waitAfterActionMs);
    await page.locator(config.selectors.startDate).first().fill(config.startDate ?? "");
    await pause(page, config.waitAfterActionMs);
    await page.locator(config.selectors.endDate).first().fill(config.endDate ?? "");
    await pause(page, config.waitAfterActionMs);

    if (config.includeOvertime) {
      await page.locator(config.selectors.overtime).first().check();
      await pause(page, config.waitAfterActionMs);
    }

    await page.locator(config.selectors.submit).first().click();
    await pause(page, config.submitWaitAfterMs);
    await page
      .locator(config.selectors.payrollTable)
      .first()
      .waitFor({ state: "visible", timeout: config.timeoutMs });
    await pause(page, config.waitAfterActionMs);

    const html = await page.content();
    const parseResult = parseFlexeposReportHtml(html, config.reportType);

    return {
      parseResult,
      storeResult: {
        store_number: storeNumber,
        status: "done",
        rows: parseResult.payload.length,
        sections: parseResult.sections.length,
        warnings: parseResult.warnings,
        scraped_html: html,
      },
    };
  } catch (caught) {
    return {
      storeResult: {
        store_number: storeNumber,
        status: "error",
        rows: 0,
        sections: 0,
        warnings: [],
        scraped_html: null,
        error:
          caught instanceof Error
            ? caught.message
            : "Unable to scrape and parse this Flexepos store.",
      },
    };
  }
}

export async function ensureAuthenticated(page: Page, config: FlexeposPayrollConfig) {
  const loginUrl = new URL(config.loginPath, config.baseUrl).href;

  await gotoWithRetry(page, loginUrl, config);

  if (await isLoggedIn(page, config)) {
    return;
  }

  await page
    .locator(config.selectors.username)
    .first()
    .waitFor({ state: "visible", timeout: config.timeoutMs });
  await pause(page, config.waitBeforeActionMs);
  await page.locator(config.selectors.username).first().fill(config.username ?? "");
  await pause(page, config.waitAfterActionMs);
  await page.locator(config.selectors.password).first().fill(config.password ?? "");
  await pause(page, config.waitAfterActionMs);
  await page.locator(config.selectors.loginSubmit).first().click();
  await pause(page, config.waitAfterActionMs);

  if (!(await isLoggedIn(page, config))) {
    throw new Error("Flexepos login did not reach a logged-in page.");
  }
}

async function isLoggedIn(page: Page, config: FlexeposPayrollConfig) {
  return page
    .locator(config.loggedInSelector)
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
}

async function findReportUrl(page: Page, config: FlexeposPayrollConfig) {
  const links = await page.evaluate(
    ({ baseUrl }) => {
      return [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .map((link) => ({
          href: new URL(link.getAttribute("href") ?? "", document.baseURI).href,
          text: (link.textContent ?? "").replace(/\s+/g, " ").trim(),
        }))
        .filter((link) => link.href.startsWith(baseUrl));
    },
    { baseUrl: config.baseUrl },
  );
  const match = links.find(
    (link) => normalizeText(link.text) === normalizeText(config.reportLinkText),
  );

  if (!match) {
    throw new Error(`No Flexepos link matched "${config.reportLinkText}".`);
  }

  return match.href;
}

function parseFlexeposReportHtml(
  html: string,
  reportType: FlexeposReportType,
): ScrapeParseResult {
  switch (reportType) {
    case "tip-breakdown-report":
      return parseTipBreakdownHtmlOnServer(html);
    case "payroll":
      return parsePayrollHtmlOnServer(html);
  }
}

export async function gotoWithRetry(
  page: Page,
  url: string,
  config: FlexeposPayrollConfig,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.navigationRetries; attempt += 1) {
    try {
      return await page.goto(url, {
        timeout: config.navigationTimeoutMs,
        waitUntil: config.navigationWaitUntil,
      });
    } catch (caught) {
      lastError = caught;

      if (attempt < config.navigationRetries) {
        await pause(page, config.waitAfterActionMs);
      }
    }
  }

  throw lastError;
}

export async function createBrowser(config: FlexeposPayrollConfig): Promise<Browser> {
  if (config.browserWsEndpoint) {
    // Keep this import statically analyzable so Next.js/Vercel includes
    // playwright-core in the serverless function trace.
    const { chromium } = await import("playwright-core") as BrowserModule;

    return config.connectMode === "playwright"
      ? chromium.connect(config.browserWsEndpoint)
      : chromium.connectOverCDP(config.browserWsEndpoint);
  }

  const { chromium } = await importBrowserModule("playwright");

  return chromium.launch({ headless: config.headless });
}

async function importBrowserModule(specifier: "playwright") {
  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<unknown>;

    return (await dynamicImport(specifier)) as BrowserModule;
  } catch (caught) {
    const cause = caught instanceof Error ? ` ${caught.message}` : "";

    throw new Error(
      `${specifier} is not available in this deployment.${cause}`,
    );
  }
}

function validateFlexeposConfig(
  config: FlexeposPayrollConfig,
  stores: string[],
) {
  if (stores.length === 0) {
    throw new Error("Set STORE_NUMBERS or provide stores before scraping Flexepos.");
  }

  if (!config.username || !config.password) {
    throw new Error("Set FMS_USERNAME and FMS_PASSWORD before scraping Flexepos.");
  }

  if (!config.startDate || !config.endDate) {
    throw new Error("Select a start date and end date before scraping Flexepos payroll.");
  }

  if (config.requiresRemoteBrowser && !config.browserWsEndpoint) {
    throw new Error(
      "Set FLEXEPOS_PLAYWRIGHT_WS_ENDPOINT in Vercel to a remote browser websocket/CDP endpoint before scraping Flexepos.",
    );
  }
}

function splitStoreNumbers(value: string | undefined) {
  return value?.split(/[\s,;]+/).filter(Boolean) ?? [];
}

function readLoadState(value: string | undefined): LoadState {
  switch (value) {
    case "domcontentloaded":
    case "load":
    case "networkidle":
      return value;
    default:
      return "commit";
  }
}

function readConnectMode(
  value: string | undefined,
  fallback: string,
): FlexeposPayrollConfig["connectMode"] {
  const normalized = value?.trim() || fallback;

  return normalized === "playwright" ? "playwright" : "cdp";
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return value !== "false";
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePayrollDateInput(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const htmlDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (htmlDateMatch) {
    const [, year, month, day] = htmlDateMatch;

    return `${month}/${day}/${year}`;
  }

  return trimmed;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function pause(page: Page, timeoutMs: number) {
  return page.waitForTimeout(timeoutMs);
}

function createDefaultRunId() {
  const suffix =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

  return `flexepos_${suffix}`;
}
