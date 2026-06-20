import { JSDOM } from "jsdom";

import { PayrollParseResult, extractPayrollPayload } from "./payrollParser";

export function parsePayrollHtmlOnServer(html: string): PayrollParseResult {
  const document = new JSDOM(html).window.document;

  return extractPayrollPayload(document);
}
