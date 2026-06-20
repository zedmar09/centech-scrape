export type PayrollPayload = {
  employee_id: number | null;
  employee_number: number | null;
  store_number: number | null;
  regular_hours: number | null;
  overtime_hours: number | null;
};

export type PayrollSection = {
  store_number: number | null;
  store_label: string | null;
  date_range: string | null;
  payload: PayrollPayload[];
};

export type PayrollParseResult = {
  sections: PayrollSection[];
  payload: PayrollPayload[];
  warnings: string[];
};

type PayrollColumnMap = {
  employeeNumber: number;
  regularHours: number;
  overtimeHours: number;
};

const DOCUMENT_POSITION_FOLLOWING = 4;

export function parsePayrollHtml(html: string): PayrollParseResult {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is not available in this environment.");
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  return extractPayrollPayload(document);
}

export function extractPayrollPayload(document: Document): PayrollParseResult {
  const warnings: string[] = [];
  const sections = Array.from(document.querySelectorAll("table"))
    .map((table) => parsePayrollTable(table))
    .filter((section): section is PayrollSection => section !== null);

  if (sections.length === 0) {
    warnings.push("No payroll tables were found in the uploaded HTML.");
  }

  return {
    sections,
    payload: sections.flatMap((section) => section.payload),
    warnings,
  };
}

export function combinePayrollParseResults(
  results: PayrollParseResult[],
): PayrollParseResult {
  const sections = results.flatMap((result) => result.sections);

  return {
    sections,
    payload: sections.flatMap((section) => section.payload),
    warnings: results.flatMap((result) => result.warnings),
  };
}

function parsePayrollTable(table: HTMLTableElement): PayrollSection | null {
  const columns = getPayrollColumns(table);

  if (!columns) {
    return null;
  }

  const storeLabel = findPreviousHeaderText(table, /store\s+\d+\s+payroll/i);
  const dateRange = findPreviousHeaderText(table, /date\s+range\s*:/i)?.replace(
    /^date\s+range\s*:\s*/i,
    "",
  ) ?? null;
  const storeNumberFromLabel = parseStoreNumber(storeLabel);

  const rows = Array.from(table.tBodies).flatMap((body) =>
    Array.from(body.rows),
  );
  const payload = rows
    .map((row) => parsePayrollRow(row, columns, storeNumberFromLabel))
    .filter((row): row is PayrollPayload => row !== null);

  if (payload.length === 0) {
    return null;
  }

  const storeNumber =
    storeNumberFromLabel ??
    payload.find((row) => row.store_number !== null)?.store_number ??
    null;

  return {
    store_number: storeNumber,
    store_label: storeLabel,
    date_range: dateRange,
    payload,
  };
}

function getPayrollColumns(table: HTMLTableElement): PayrollColumnMap | null {
  const headers = Array.from(table.querySelectorAll("thead th")).map((header) =>
    normalizeKey(header.textContent),
  );

  const employeeNumber = headers.indexOf("employeenumber");
  const regularHours = headers.indexOf("regularhours");
  const overtimeHours = headers.indexOf("overtimehours");

  if (employeeNumber === -1 || regularHours === -1 || overtimeHours === -1) {
    return null;
  }

  return {
    employeeNumber,
    regularHours,
    overtimeHours,
  };
}

function parsePayrollRow(
  row: HTMLTableRowElement,
  columns: PayrollColumnMap,
  sectionStoreNumber: number | null,
): PayrollPayload | null {
  const cells = Array.from(row.cells);
  const firstCellText = normalizeText(cells[0]?.textContent);

  if (firstCellText.toLowerCase() === "total") {
    return null;
  }

  if (
    cells.length <=
    Math.max(columns.employeeNumber, columns.regularHours, columns.overtimeHours)
  ) {
    return null;
  }

  const detailLink = cells[0].querySelector("a[href]");
  const detailParams = readQueryParams(detailLink?.getAttribute("href"));
  const storeNumber = parseNullableInteger(detailParams.get("storeNumber"));

  const payload = {
    employee_id: parseNullableInteger(detailParams.get("id")),
    employee_number: parseNullableInteger(
      normalizeText(cells[columns.employeeNumber].textContent),
    ),
    store_number: storeNumber ?? sectionStoreNumber,
    regular_hours: parseNullableDecimal(
      normalizeText(cells[columns.regularHours].textContent),
    ),
    overtime_hours: parseNullableDecimal(
      normalizeText(cells[columns.overtimeHours].textContent),
    ),
  };

  if (!hasEmployeePayrollData(payload)) {
    return null;
  }

  return payload;
}

function findPreviousHeaderText(
  table: HTMLTableElement,
  pattern: RegExp,
): string | null {
  const headers = Array.from(
    table.ownerDocument.querySelectorAll<HTMLElement>(".header-text"),
  );
  const previousMatches = headers
    .filter((header) => {
      return Boolean(
        header.compareDocumentPosition(table) & DOCUMENT_POSITION_FOLLOWING,
      );
    })
    .map((header) => normalizeText(header.textContent))
    .filter((text) => pattern.test(text));

  return previousMatches.at(-1) ?? null;
}

function parseStoreNumber(storeLabel: string | null): number | null {
  const match = storeLabel?.match(/store\s+(\d+)\s+payroll/i);
  return parseNullableInteger(match?.[1] ?? null);
}

function hasEmployeePayrollData(payload: PayrollPayload): boolean {
  return (
    payload.employee_id !== null ||
    payload.employee_number !== null ||
    payload.regular_hours !== null ||
    payload.overtime_hours !== null
  );
}

function readQueryParams(href: string | null | undefined): URLSearchParams {
  if (!href) {
    return new URLSearchParams();
  }

  try {
    return new URL(href, "https://local.payroll").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function parseNullableInteger(value: string | null | undefined): number | null {
  const normalized = normalizeNumericText(value);

  if (!normalized || !/^-?\d+$/.test(normalized)) {
    return null;
  }

  return Number.parseInt(normalized, 10);
}

function parseNullableDecimal(value: string | null | undefined): number | null {
  const normalized = normalizeNumericText(value);

  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  return Number.parseFloat(normalized);
}

function normalizeNumericText(value: string | null | undefined): string {
  return normalizeText(value).replaceAll(",", "");
}

function normalizeKey(value: string | null | undefined): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
