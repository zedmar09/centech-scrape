import { parse, type DefaultTreeAdapterTypes } from "parse5";

import type {
  TipBreakdownParseResult,
  TipBreakdownPayload,
  TipBreakdownSection,
} from "./tipBreakdownParser";

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlParentNode = DefaultTreeAdapterTypes.ParentNode;
type HtmlElement = DefaultTreeAdapterTypes.Element;

type TipBreakdownColumnMap = {
  payIns: number;
  total: number;
};

type TipBreakdownRowTotal = {
  isTotalRow: boolean;
  payIns: number;
  total: number;
};

export function parseTipBreakdownHtmlOnServer(
  html: string,
): TipBreakdownParseResult {
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
    .map((table) => parseTipBreakdownTable(table, elements, headerElements))
    .filter((section): section is TipBreakdownSection => section !== null);

  if (sections.length === 0) {
    warnings.push("No tip breakdown report tables were found in the scraped HTML.");
  }

  return {
    sections,
    payload: sections.flatMap((section) => section.payload),
    warnings,
  };
}

function parseTipBreakdownTable(
  table: HtmlElement,
  elements: HtmlElement[],
  headerElements: HtmlElement[],
): TipBreakdownSection | null {
  const columns = getTipBreakdownColumns(table);

  if (!columns) {
    return null;
  }

  const rowTotals = getReportRows(table)
    .map((row) => parseTipBreakdownRow(row, columns))
    .filter((row): row is TipBreakdownRowTotal => row !== null);

  if (rowTotals.length === 0) {
    return null;
  }

  const rowsToSum = rowTotals.some((row) => row.isTotalRow)
    ? rowTotals.filter((row) => row.isTotalRow)
    : rowTotals;
  const storeLabel =
    findPreviousHeaderText(table, elements, headerElements, /^\d+$/) ??
    findPreviousHeaderText(table, elements, headerElements, /store\s+\d+/i);
  const dateRange =
    findPreviousHeaderText(
      table,
      elements,
      headerElements,
      /date\s+range\s*:/i,
    )?.replace(/^date\s+range\s*:\s*/i, "") ?? null;
  const storeNumber = parseStoreNumber(storeLabel);
  const payload: TipBreakdownPayload = {
    store_number: storeNumber,
    total_payins: sumCurrency(rowsToSum.map((row) => row.payIns)),
    total_tips: sumCurrency(rowsToSum.map((row) => row.total)),
  };

  return {
    store_number: storeNumber,
    store_label: storeLabel,
    date_range: dateRange,
    payload: [payload],
  };
}

function getTipBreakdownColumns(table: HtmlElement): TipBreakdownColumnMap | null {
  const headers = findDescendantElements(table, "thead")
    .flatMap((thead) => findDescendantElements(thead, "th"))
    .map((header) => normalizeKey(textContent(header)));

  const payIns = headers.indexOf("payins");
  const total = headers.indexOf("total");

  if (payIns === -1 || total === -1) {
    return null;
  }

  return { payIns, total };
}

function getReportRows(table: HtmlElement) {
  const bodyRows = directChildElements(table, "tbody").flatMap((body) =>
    directChildElements(body, "tr"),
  );

  if (bodyRows.length > 0) {
    return bodyRows;
  }

  return findDescendantElements(table, "tr").filter(
    (row) => findDescendantElements(row, "th").length === 0,
  );
}

function parseTipBreakdownRow(
  row: HtmlElement,
  columns: TipBreakdownColumnMap,
): TipBreakdownRowTotal | null {
  const cells = row.childNodes.filter(
    (node): node is HtmlElement =>
      isElement(node) && (node.tagName === "td" || node.tagName === "th"),
  );

  if (cells.length <= Math.max(columns.payIns, columns.total)) {
    return null;
  }

  const payIns = parseCurrency(textContent(cells[columns.payIns]));
  const total = parseCurrency(textContent(cells[columns.total]));

  if (payIns === null && total === null) {
    return null;
  }

  return {
    isTotalRow: normalizeText(textContent(cells[0])).toLowerCase() === "total",
    payIns: payIns ?? 0,
    total: total ?? 0,
  };
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

function parseStoreNumber(storeLabel: string | null): string | null {
  const normalized = normalizeText(storeLabel);
  const directMatch = /^(\d+)$/.exec(normalized);
  const storeMatch = /store\s+(\d+)/i.exec(normalized);

  return directMatch?.[1] ?? storeMatch?.[1] ?? null;
}

function parseCurrency(value: string | null | undefined): number | null {
  const normalized = normalizeText(value)
    .replace(/[$,]/g, "")
    .replace(/^\((\d+(?:\.\d+)?)\)$/, "-$1");

  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  return Number.parseFloat(normalized);
}

function sumCurrency(values: number[]) {
  return Number(values.reduce((total, value) => total + value, 0).toFixed(2));
}

function normalizeKey(value: string | null | undefined): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
