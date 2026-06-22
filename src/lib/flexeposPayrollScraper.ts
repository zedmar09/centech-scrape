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

export const DEFAULT_FLEXEPOS_STORE_NUMBERS = [
  "2006",
  "2016",
  "2017",
  "2020",
  "2023",
  "2024",
  "2047",
  "4003",
  "4004",
  "4005",
  "4008",
  "4009",
  "4010",
  "4015",
  "4021",
  "4025",
  "4027",
  "4034",
  "4036",
  "4042",
  "4052",
  "4061",
  "4074",
  "4083",
  "5042",
  "5043",
  "5049",
  "5051",
  "5057",
  "5059",
  "5062",
  "5101",
  "5112",
  "5127",
  "6021",
  "6026",
  "6032",
  "6037",
  "6039",
  "6044",
  "6065",
  "6067",
  "6072",
  "6074",
  "6076",
  "6083",
  "6088",
  "6093",
  "6094",
  "6102",
  "7024",
  "7032",
  "7039",
  "7049",
  "7066",
  "13026",
  "13062",
  "13082",
  "13106",
  "13116",
  "13138",
  "13148",
  "13160",
  "13162",
  "13219",
  "37001",
  "37002",
  "37004",
  "37006",
  "37007",
  "37009",
  "37010",
  "37013",
  "37014",
  "37016",
  "37020",
  "49001",
  "49002",
  "49003",
  "49004",
  "49005",
  "49006",
  "49007",
  "49008",
  "49009",
  "49010",
  "49011",
];

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

type Browser = {
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
  newPage: () => Promise<Page>;
};

type Page = {
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
};

type Locator = {
  check: () => Promise<void>;
  click: () => Promise<void>;
  fill: (value: string) => Promise<void>;
  first: () => Locator;
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
  const waitAfterActionMs = readPositiveInteger(
    env.FLEXEPOS_WAIT_AFTER_ACTION_MS,
    1_500,
  );
  const reportLinkText =
    reportType === "payroll"
      ? env.FLEXEPOS_PAYROLL_LINK_TEXT?.trim() || reportTarget.defaultLinkText
      : env.FLEXEPOS_TIP_BREAKDOWN_LINK_TEXT?.trim() ||
        reportTarget.defaultLinkText;

  return {
    baseUrl: env.FLEXEPOS_BASE_URL?.trim() || "https://fms.flexepos.com/FlexeposWeb/",
    browserWsEndpoint: env.FLEXEPOS_PLAYWRIGHT_WS_ENDPOINT?.trim() || null,
    connectMode:
      env.FLEXEPOS_PLAYWRIGHT_CONNECT_MODE === "playwright"
        ? "playwright"
        : "cdp",
    endDate: normalizePayrollDateInput(overrides.endDate),
    headless: env.FLEXEPOS_HEADLESS !== "false",
    includeOvertime: reportTarget.includeOvertime,
    loginPath: env.FLEXEPOS_LOGIN_PATH?.trim() || "home.seam",
    loggedInSelector:
      env.FLEXEPOS_LOGGED_IN_SELECTOR?.trim() || "a:has-text('Logout')",
    navigationRetries: readPositiveInteger(env.FLEXEPOS_NAVIGATION_RETRIES, 2),
    navigationTimeoutMs: readPositiveInteger(
      env.FLEXEPOS_NAVIGATION_TIMEOUT_MS,
      90_000,
    ),
    navigationWaitUntil: readLoadState(env.FLEXEPOS_NAVIGATION_WAIT_UNTIL),
    password: env.FMS_PASSWORD || null,
    payrollLinkText: env.FLEXEPOS_PAYROLL_LINK_TEXT?.trim() || "Payroll",
    reportLinkText,
    reportType,
    requiresRemoteBrowser: env.VERCEL === "1" || env.VERCEL === "true",
    selectors: {
      username: env.FLEXEPOS_USERNAME_SELECTOR?.trim() || "#login\\:username",
      password: env.FLEXEPOS_PASSWORD_SELECTOR?.trim() || "#login\\:password",
      loginSubmit:
        env.FLEXEPOS_LOGIN_SUBMIT_SELECTOR?.trim() ||
        "form#login input[type='submit']",
      store:
        env.FLEXEPOS_STORE_SELECTOR?.trim() ||
        "input[name='parameters:store']",
      startDate:
        env.FLEXEPOS_START_DATE_SELECTOR?.trim() ||
        "input[name='parameters:startDateCalendarInputDate']",
      endDate:
        env.FLEXEPOS_END_DATE_SELECTOR?.trim() ||
        "input[name='parameters:endDateCalendarInputDate']",
      overtime:
        env.FLEXEPOS_OVERTIME_SELECTOR?.trim() ||
        "input[name='parameters:j_id55']",
      submit:
        env.FLEXEPOS_SUBMIT_SELECTOR?.trim() || "input[value='Submit']",
      payrollTable: env.FLEXEPOS_PAYROLL_TABLE_SELECTOR?.trim() || "table",
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
      reportTarget.submitWaitAfterMs ?? waitAfterActionMs,
    ),
    timeoutMs: readPositiveInteger(env.FLEXEPOS_TIMEOUT_MS, 30_000),
    username: env.FMS_USERNAME?.trim() || null,
    waitAfterActionMs,
    waitBeforeActionMs: readPositiveInteger(
      env.FLEXEPOS_WAIT_BEFORE_ACTION_MS,
      500,
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

async function ensureAuthenticated(page: Page, config: FlexeposPayrollConfig) {
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

async function gotoWithRetry(
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

async function createBrowser(config: FlexeposPayrollConfig): Promise<Browser> {
  if (config.browserWsEndpoint) {
    const { chromium } = await importBrowserModule("playwright-core");

    return config.connectMode === "playwright"
      ? chromium.connect(config.browserWsEndpoint)
      : chromium.connectOverCDP(config.browserWsEndpoint);
  }

  const { chromium } = await importBrowserModule("playwright");

  return chromium.launch({ headless: config.headless });
}

async function importBrowserModule(specifier: "playwright" | "playwright-core") {
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
