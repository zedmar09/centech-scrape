import { parse, type DefaultTreeAdapterTypes } from "parse5";

import {
  type PayrollParseResult,
  type PayrollPayload,
  type PayrollSection,
} from "./payrollParser";

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlParentNode = DefaultTreeAdapterTypes.ParentNode;
type HtmlElement = DefaultTreeAdapterTypes.Element;

type PayrollColumnMap = {
  employeeNumber: number;
  regularHours: number;
  overtimeHours: number;
};

export function parsePayrollHtmlOnServer(html: string): PayrollParseResult {
  const document = parse(html);
  const elements = listElementsInDocumentOrder(document);
  const headerElements = elements.filter(
    (element) =>
      hasClass(element, "header-text") &&
      textContent(element).trim().length > 0,
  );
  const warnings: string[] = [];
  const sections = elements
    .filter((element) => element.tagName === "table")
    .map((table) => parsePayrollTable(table, elements, headerElements))
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

function parsePayrollTable(
  table: HtmlElement,
  elements: HtmlElement[],
  headerElements: HtmlElement[],
): PayrollSection | null {
  const columns = getPayrollColumns(table);

  if (!columns) {
    return null;
  }

  const storeLabel = findPreviousHeaderText(
    table,
    elements,
    headerElements,
    /store\s+\d+\s+payroll/i,
  );
  const dateRange =
    findPreviousHeaderText(
      table,
      elements,
      headerElements,
      /date\s+range\s*:/i,
    )?.replace(/^date\s+range\s*:\s*/i, "") ?? null;
  const storeNumberFromLabel = parseStoreNumber(storeLabel);
  const rows = directChildElements(table, "tbody").flatMap((body) =>
    directChildElements(body, "tr"),
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

function getPayrollColumns(table: HtmlElement): PayrollColumnMap | null {
  const headers = findDescendantElements(table, "thead")
    .flatMap((thead) => findDescendantElements(thead, "th"))
    .map((header) => normalizeKey(textContent(header)));

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
  row: HtmlElement,
  columns: PayrollColumnMap,
  sectionStoreNumber: number | null,
): PayrollPayload | null {
  const cells = row.childNodes.filter(
    (node): node is HtmlElement =>
      isElement(node) && (node.tagName === "td" || node.tagName === "th"),
  );
  const firstCellText = normalizeText(textContent(cells[0]));

  if (firstCellText.toLowerCase() === "total") {
    return null;
  }

  if (
    cells.length <=
    Math.max(columns.employeeNumber, columns.regularHours, columns.overtimeHours)
  ) {
    return null;
  }

  const detailLink = findDescendantElements(cells[0], "a").find((link) =>
    Boolean(getAttribute(link, "href")),
  );
  const detailParams = readQueryParams(getAttribute(detailLink, "href"));
  const storeNumber = parseNullableInteger(detailParams.get("storeNumber"));

  const payload = {
    employee_id: parseNullableInteger(detailParams.get("id")),
    employee_number: parseNullableInteger(
      normalizeText(textContent(cells[columns.employeeNumber])),
    ),
    store_number: storeNumber ?? sectionStoreNumber,
    regular_hours: parseNullableDecimal(
      normalizeText(textContent(cells[columns.regularHours])),
    ),
    overtime_hours: parseNullableDecimal(
      normalizeText(textContent(cells[columns.overtimeHours])),
    ),
  };

  if (!hasEmployeePayrollData(payload)) {
    return null;
  }

  return payload;
}

function findPreviousHeaderText(
  table: HtmlElement,
  elements: HtmlElement[],
  headerElements: HtmlElement[],
  pattern: RegExp,
): string | null {
  const tableIndex = elements.indexOf(table);
  const matches = headerElements
    .filter((header) => elements.indexOf(header) < tableIndex)
    .map((header) => normalizeText(textContent(header)))
    .filter((text) => pattern.test(text));

  return matches.at(-1) ?? null;
}

function listElementsInDocumentOrder(root: HtmlParentNode): HtmlElement[] {
  const elements: HtmlElement[] = [];

  for (const child of root.childNodes) {
    if (!isElement(child)) {
      continue;
    }

    elements.push(child);
    elements.push(...listElementsInDocumentOrder(child));
  }

  return elements;
}

function findDescendantElements(
  root: HtmlParentNode,
  tagName: string,
): HtmlElement[] {
  return listElementsInDocumentOrder(root).filter(
    (element) => element.tagName === tagName,
  );
}

function directChildElements(
  element: HtmlElement,
  tagName: string,
): HtmlElement[] {
  return element.childNodes.filter(
    (node): node is HtmlElement => isElement(node) && node.tagName === tagName,
  );
}

function textContent(node: HtmlNode | undefined): string {
  if (!node) {
    return "";
  }

  if ("value" in node) {
    return node.value;
  }

  if (!("childNodes" in node)) {
    return "";
  }

  return node.childNodes.map((child) => textContent(child)).join("");
}

function getAttribute(
  element: HtmlElement | undefined,
  name: string,
): string | null {
  return (
    element?.attrs.find((attribute) => attribute.name.toLowerCase() === name)
      ?.value ?? null
  );
}

function hasClass(element: HtmlElement, className: string): boolean {
  return getAttribute(element, "class")?.split(/\s+/).includes(className) ?? false;
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
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
