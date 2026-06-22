import type {
  PayrollParseResult,
  PayrollPayload,
  PayrollSection,
} from "./payrollParser";
import type {
  TipBreakdownParseResult,
  TipBreakdownPayload,
  TipBreakdownSection,
} from "./tipBreakdownParser";

export const FLEXEPOS_REPORT_TYPES = [
  "payroll",
  "tip-breakdown-report",
] as const;

export type FlexeposReportType = (typeof FLEXEPOS_REPORT_TYPES)[number];

export type FlexeposReportOption = {
  type: FlexeposReportType;
  label: string;
};

export type FlexeposReportTarget = FlexeposReportOption & {
  defaultLinkText: string;
  includeOvertime: boolean;
  submitWaitAfterMs?: number;
};

export type ScrapePayload = PayrollPayload | TipBreakdownPayload;
export type ScrapeSection = PayrollSection | TipBreakdownSection;
export type ScrapeParseResult = {
  sections: ScrapeSection[];
  payload: ScrapePayload[];
  warnings: string[];
};

export type KnownScrapeParseResult = PayrollParseResult | TipBreakdownParseResult;

export const FLEXEPOS_REPORT_TARGETS: Record<
  FlexeposReportType,
  FlexeposReportTarget
> = {
  payroll: {
    type: "payroll",
    label: "Payroll",
    defaultLinkText: "Payroll",
    includeOvertime: true,
  },
  "tip-breakdown-report": {
    type: "tip-breakdown-report",
    label: "Tip Breakdown Report",
    defaultLinkText: "Tip Breakdown Report",
    includeOvertime: false,
    submitWaitAfterMs: 3000,
  },
};

export const FLEXEPOS_REPORT_OPTIONS = FLEXEPOS_REPORT_TYPES.map(
  (type) => ({
    type,
    label: FLEXEPOS_REPORT_TARGETS[type].label,
  }),
);

export const EMPTY_SCRAPE_PARSE_RESULT: ScrapeParseResult = {
  payload: [],
  sections: [],
  warnings: [],
};

export function parseFlexeposReportType(value: unknown): FlexeposReportType {
  return FLEXEPOS_REPORT_TYPES.find((type) => type === value) ?? "payroll";
}

export function getFlexeposReportTarget(
  reportType: FlexeposReportType,
): FlexeposReportTarget {
  return FLEXEPOS_REPORT_TARGETS[reportType];
}

export function getFlexeposReportLabel(reportType: FlexeposReportType) {
  return getFlexeposReportTarget(reportType).label;
}

export function combineScrapeParseResults(
  results: ScrapeParseResult[],
): ScrapeParseResult {
  return {
    sections: results.flatMap((result) => result.sections),
    payload: results.flatMap((result) => result.payload),
    warnings: results.flatMap((result) => result.warnings),
  };
}
