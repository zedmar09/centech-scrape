"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  CssBaseline,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  SvgIcon,
  SvgIconProps,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  createTheme,
} from "@mui/material";

import type { PayrollPayload } from "@/lib/payrollParser";
import {
  EMPTY_SCRAPE_PARSE_RESULT,
  FLEXEPOS_REPORT_OPTIONS,
  type FlexeposReportOption,
  type FlexeposReportType,
  type ScrapePayload,
  getFlexeposReportLabel,
} from "@/lib/reportTypes";
import {
  DEFAULT_SCRAPE_BATCH_SIZE,
  chunkStoreNumbers,
  createFailedScrapeRun,
  createQueuedScrapeRun,
  getFailedStoreNumbers,
  getScrapeProgress,
  markStoresScraping,
  mergeScrapeRunBatch,
  type ScrapeProgress,
} from "@/lib/scrapeBatching";
import type { PayrollScrapeRun, PayrollScrapeStoreResult } from "@/lib/scrapeRuns";
import {
  createScrapeRunRequestBody,
  parseStoreNumbersInput,
} from "@/lib/scrapeRequest";
import type { TipBreakdownPayload } from "@/lib/tipBreakdownParser";

const theme = createTheme({
  palette: {
    mode: "light",
    background: {
      default: "#f4f6f8",
      paper: "#ffffff",
    },
    primary: {
      main: "#14532d",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#334155",
    },
    success: {
      main: "#16803c",
    },
    warning: {
      main: "#b45309",
    },
    text: {
      primary: "#18202a",
      secondary: "#5b6675",
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: "var(--font-geist-sans), Arial, sans-serif",
    h1: {
      fontSize: "2rem",
      lineHeight: 1.2,
      fontWeight: 700,
      letterSpacing: 0,
    },
    h2: {
      fontSize: "1.1rem",
      lineHeight: 1.25,
      fontWeight: 700,
      letterSpacing: 0,
    },
    button: {
      textTransform: "none",
      fontWeight: 700,
      letterSpacing: 0,
    },
  },
});

type ScrapeUiStatus = "idle" | "running" | "complete" | "error";
type SaveUiStatus = "idle" | "saving" | "saved" | "error";

const EMPTY_SCRAPE_PROGRESS: ScrapeProgress = {
  completed: 0,
  failed: 0,
  percent: 0,
  total: 0,
};

type ScrapeConfigResponse = {
  batch_size?: unknown;
  reports?: unknown;
  store_numbers?: unknown;
};

export function PayrollImporter() {
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [reportType, setReportType] = useState<FlexeposReportType>("payroll");
  const [scrapeRun, setScrapeRun] = useState<PayrollScrapeRun | null>(null);
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeUiStatus>("idle");
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveUiStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    return scrapeRun?.result ?? EMPTY_SCRAPE_PARSE_RESULT;
  }, [scrapeRun]);
  const resultReportType = scrapeRun?.report_type ?? reportType;
  const resultReportLabel = getFlexeposReportLabel(resultReportType);

  const payloadJson = useMemo(() => {
    return JSON.stringify(result.payload, null, 2);
  }, [result.payload]);

  const payrollPayloadRows = useMemo(() => {
    return result.payload.filter(isPayrollPayload);
  }, [result.payload]);

  const tipBreakdownPayloadRows = useMemo(() => {
    return result.payload.filter(isTipBreakdownPayload);
  }, [result.payload]);

  const totalRegularHours = useMemo(() => {
    return sumHours(payrollPayloadRows, "regular_hours");
  }, [payrollPayloadRows]);

  const totalOvertimeHours = useMemo(() => {
    return sumHours(payrollPayloadRows, "overtime_hours");
  }, [payrollPayloadRows]);

  const totalTipPayIns = useMemo(() => {
    return sumTipAmount(tipBreakdownPayloadRows, "total_payins");
  }, [tipBreakdownPayloadRows]);

  const totalTips = useMemo(() => {
    return sumTipAmount(tipBreakdownPayloadRows, "total_tips");
  }, [tipBreakdownPayloadRows]);

  const scrapeSummary = useMemo(() => {
    const storeResults = scrapeRun?.store_results ?? [];
    const failed = storeResults.filter((store) => store.status === "error").length;
    const done = storeResults.filter((store) => store.status === "done").length;

    return {
      done,
      failed,
      rows: scrapeRun?.result.payload.length ?? 0,
      sections: scrapeRun?.result.sections.length ?? 0,
      total: storeResults.length,
    };
  }, [scrapeRun]);

  const scrapeProgress = useMemo(() => {
    return scrapeRun ? getScrapeProgress(scrapeRun) : EMPTY_SCRAPE_PROGRESS;
  }, [scrapeRun]);

  const failedStoreNumbers = useMemo(() => {
    return scrapeRun ? getFailedStoreNumbers(scrapeRun) : [];
  }, [scrapeRun]);

  const hasInvalidScrapeDateRange = Boolean(
    startDateInput && endDateInput && startDateInput > endDateInput,
  );
  const isRetryDisabled =
    scrapeStatus === "running" ||
    !scrapeRun ||
    failedStoreNumbers.length === 0 ||
    !startDateInput ||
    !endDateInput ||
    hasInvalidScrapeDateRange;

  function clearScrapeResults() {
    setScrapeRun(null);
    setScrapeStatus("idle");
    setScrapeError(null);
    setSaveStatus("idle");
    setSaveError(null);
    setCopied(false);
  }

  async function copyPayload() {
    await navigator.clipboard.writeText(payloadJson);
    setCopied(true);
  }

  function downloadPayload() {
    const blob = new Blob([payloadJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = scrapeRun
      ? `${scrapeRun.run_id}.${resultReportType}.payload.json`
      : `${reportType}.payload.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function fetchScrapeConfig() {
    const response = await fetch("/api/scrape-runs", {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const body = (await response.json()) as ScrapeConfigResponse;
    const stores = parseStoreNumbersInput(body.store_numbers);
    const rawBatchSize =
      typeof body.batch_size === "number" && Number.isFinite(body.batch_size)
        ? body.batch_size
        : DEFAULT_SCRAPE_BATCH_SIZE;
    const batchSize = Math.min(
      DEFAULT_SCRAPE_BATCH_SIZE,
      Math.max(1, Math.floor(rawBatchSize)),
    );

    if (stores.length === 0) {
      throw new Error("No store numbers are configured for this scrape.");
    }

    return {
      batchSize,
      stores,
    };
  }

  async function scrapeSingleStore(
    storeNumber: string,
    {
      endDate,
      reportType,
      startedAt,
      startDate,
    }: {
      endDate: string;
      reportType: FlexeposReportType;
      startedAt: string;
      startDate: string;
    },
  ) {
    try {
      const response = await fetch("/api/scrape-runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(
          createScrapeRunRequestBody({
            endDate,
            reportType,
            startDate,
            stores: [storeNumber],
          }),
        ),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      return (await response.json()) as PayrollScrapeRun;
    } catch (caught) {
      return createFailedScrapeRun({
        error:
          caught instanceof Error
            ? caught.message
            : "Unable to scrape this store.",
        finishedAt: new Date().toISOString(),
        reportType,
        startedAt,
        stores: [storeNumber],
      });
    }
  }

  async function startScrapeRun() {
    setScrapeStatus("running");
    setScrapeError(null);
    setScrapeRun(null);
    setSaveStatus("idle");
    setSaveError(null);
    setCopied(false);

    try {
      const { batchSize, stores } = await fetchScrapeConfig();
      const startedAt = new Date().toISOString();
      const selectedReportType = reportType;
      let workingRun = createQueuedScrapeRun({
        reportType: selectedReportType,
        runId: createClientRunId(),
        startedAt,
        stores,
      });

      setScrapeRun(workingRun);

      workingRun = await runStoreBatches({
        batchSize,
        reportType: selectedReportType,
        run: workingRun,
        startedAt,
        stores,
      });

      setScrapeStatus("complete");
    } catch (caught) {
      setScrapeStatus("error");
      setScrapeError(
        caught instanceof Error
          ? caught.message
          : "Unable to complete this scrape run.",
      );
    }
  }

  async function retryFailedStores(stores: string[]) {
    if (!scrapeRun || stores.length === 0) {
      return;
    }

    setScrapeStatus("running");
    setScrapeError(null);
    setSaveStatus("idle");
    setSaveError(null);
    setCopied(false);

    try {
      const selectedReportType = scrapeRun.report_type ?? reportType;

      await runStoreBatches({
        batchSize: DEFAULT_SCRAPE_BATCH_SIZE,
        reportType: selectedReportType,
        run: scrapeRun,
        startedAt: new Date().toISOString(),
        stores,
      });

      setScrapeStatus("complete");
    } catch (caught) {
      setScrapeStatus("error");
      setScrapeError(
        caught instanceof Error ? caught.message : "Unable to retry failed stores.",
      );
    }
  }

  async function runStoreBatches({
    batchSize,
    reportType,
    run,
    startedAt,
    stores,
  }: {
    batchSize: number;
    reportType: FlexeposReportType;
    run: PayrollScrapeRun;
    startedAt: string;
    stores: string[];
  }) {
    let workingRun = run;

    for (const batch of chunkStoreNumbers(stores, batchSize)) {
      workingRun = markStoresScraping(workingRun, batch);
      setScrapeRun(workingRun);

      const batchRuns = await Promise.all(
        batch.map((storeNumber) =>
          scrapeSingleStore(storeNumber, {
            endDate: endDateInput,
            reportType,
            startDate: startDateInput,
            startedAt,
          }),
        ),
      );

      workingRun = mergeScrapeRunBatch(workingRun, batchRuns, {
        finishedAt: new Date().toISOString(),
      });
      setScrapeRun(workingRun);
    }

    return workingRun;
  }

  async function savePayload() {
    setSaveStatus("saving");
    setSaveError(null);

    try {
      const response = await fetch("/api/payroll-payloads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          report_type: resultReportType,
          run_id: scrapeRun?.run_id ?? null,
          payload: result.payload,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      setSaveStatus("saved");
    } catch (caught) {
      setSaveStatus("error");
      setSaveError(
        caught instanceof Error ? caught.message : "Unable to save this payload.",
      );
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        component="main"
        sx={{
          minHeight: "100vh",
          bgcolor: "background.default",
          py: { xs: 3, md: 5 },
        }}
      >
        <Container maxWidth="xl">
          <Stack spacing={3}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={2}
              sx={{
                alignItems: { xs: "stretch", md: "center" },
                justifyContent: "space-between",
              }}
            >
              <Box>
                <Typography component="h1" variant="h1">
                  Flexepos Payload Builder
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                  Scrape configured stores, inspect the HTML returned by the
                  site, then review the {resultReportLabel} payload.
                </Typography>
              </Box>

              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                <Button
                  variant="outlined"
                  startIcon={<RetryIcon />}
                  disabled={isRetryDisabled}
                  onClick={() => retryFailedStores(failedStoreNumbers)}
                >
                  Retry All Failed
                </Button>
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  disabled={result.payload.length === 0 || saveStatus === "saving"}
                  onClick={savePayload}
                >
                  {saveStatus === "saving" ? "Saving" : "Save Payload"}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  disabled={result.payload.length === 0}
                  onClick={downloadPayload}
                >
                  Download JSON
                </Button>
                <Button
                  variant="text"
                  startIcon={<ClearIcon />}
                  disabled={!scrapeRun || scrapeStatus === "running"}
                  onClick={clearScrapeResults}
                >
                  Clear Scrape Results
                </Button>
              </Box>
            </Stack>

            <ScrapePanel
              endDateInput={endDateInput}
              hasInvalidDateRange={hasInvalidScrapeDateRange}
              reportOptions={FLEXEPOS_REPORT_OPTIONS}
              reportType={reportType}
              scrapeRun={scrapeRun}
              scrapeProgress={scrapeProgress}
              scrapeStatus={scrapeStatus}
              scrapeSummary={scrapeSummary}
              startDateInput={startDateInput}
              onEndDateInputChange={setEndDateInput}
              onReportTypeChange={setReportType}
              onRetryStore={(storeNumber) => retryFailedStores([storeNumber])}
              onStartDateInputChange={setStartDateInput}
              onStart={startScrapeRun}
              retryDisabled={
                scrapeStatus === "running" ||
                !startDateInput ||
                !endDateInput ||
                hasInvalidScrapeDateRange
              }
            />

            {scrapeStatus === "error" && scrapeError ? (
              <Alert severity="error" icon={<WarningIcon />}>
                {scrapeError}
              </Alert>
            ) : null}

            {scrapeRun?.status === "completed_with_errors" ? (
              <Alert severity="warning" icon={<WarningIcon />}>
                {scrapeSummary.failed} store(s) failed. Successful stores were
                still parsed into the combined payload.
              </Alert>
            ) : null}

            {saveStatus === "saved" ? (
              <Alert severity="success" icon={<CheckCircleIcon />}>
                Payload sent to the backend.
              </Alert>
            ) : null}

            {saveStatus === "error" && saveError ? (
              <Alert severity="error" icon={<WarningIcon />}>
                {saveError}
              </Alert>
            ) : null}

            {scrapeRun ? (
              <ScrapedHtmlPanel stores={scrapeRun.store_results} />
            ) : null}

            <Stack
              direction={{ xs: "column", lg: "row" }}
              spacing={3}
              sx={{ alignItems: "stretch" }}
            >
              <Paper
                variant="outlined"
                sx={{
                  flex: 1.4,
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <SectionHeader title="Payload Rows">
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {resultReportType === "tip-breakdown-report" ? (
                      <>
                        <Chip
                          label={`Pay-Ins ${formatAmount(totalTipPayIns)}`}
                          size="small"
                        />
                        <Chip
                          label={`Tips ${formatAmount(totalTips)}`}
                          size="small"
                        />
                      </>
                    ) : (
                      <>
                        <Chip
                          label={`Regular ${formatHours(totalRegularHours)}`}
                          size="small"
                        />
                        <Chip
                          label={`Overtime ${formatHours(totalOvertimeHours)}`}
                          size="small"
                        />
                      </>
                    )}
                  </Box>
                </SectionHeader>
                <Divider />
                <PayloadTable reportType={resultReportType} rows={result.payload} />
              </Paper>

              <Paper
                variant="outlined"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <SectionHeader title="JSON Payload">
                  <Tooltip title={copied ? "Copied" : "Copy JSON"}>
                    <span>
                      <IconButton
                        aria-label="Copy JSON"
                        disabled={result.payload.length === 0}
                        onClick={copyPayload}
                        size="small"
                      >
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </SectionHeader>
                <Divider />
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 2,
                    minHeight: 360,
                    maxHeight: 580,
                    overflow: "auto",
                    bgcolor: "#101820",
                    color: "#dbeafe",
                    fontFamily:
                      "var(--font-geist-mono), ui-monospace, monospace",
                    fontSize: "0.82rem",
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {payloadJson}
                </Box>
              </Paper>
            </Stack>

            <Paper variant="outlined" sx={{ overflow: "hidden" }}>
              <SectionHeader title="Detected Sections" />
              <Divider />
              <TableContainer>
                <Table size="small" aria-label="Detected payroll sections">
                  <TableHead>
                    <TableRow>
                      <TableCell>Store</TableCell>
                      <TableCell>Date Range</TableCell>
                      <TableCell align="right">Rows</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.sections.map((section, index) => (
                      <TableRow key={`${section.store_number ?? "store"}-${index}`}>
                        <TableCell>{section.store_label ?? "-"}</TableCell>
                        <TableCell>{section.date_range ?? "-"}</TableCell>
                        <TableCell align="right">{section.payload.length}</TableCell>
                      </TableRow>
                    ))}
                    {result.sections.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} sx={{ color: "text.secondary" }}>
                          No sections loaded.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Stack>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

function SectionHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{
        alignItems: "center",
        justifyContent: "space-between",
        px: 2,
        py: 1.5,
      }}
    >
      <Typography component="h2" variant="h2">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

function ScrapePanel({
  endDateInput,
  hasInvalidDateRange,
  reportOptions,
  reportType,
  scrapeRun,
  scrapeProgress,
  scrapeStatus,
  scrapeSummary,
  startDateInput,
  onEndDateInputChange,
  onReportTypeChange,
  onRetryStore,
  onStartDateInputChange,
  onStart,
  retryDisabled,
}: {
  endDateInput: string;
  hasInvalidDateRange: boolean;
  reportOptions: FlexeposReportOption[];
  reportType: FlexeposReportType;
  scrapeRun: PayrollScrapeRun | null;
  scrapeProgress: ScrapeProgress;
  scrapeStatus: ScrapeUiStatus;
  scrapeSummary: {
    done: number;
    failed: number;
    rows: number;
    sections: number;
    total: number;
  };
  startDateInput: string;
  onEndDateInputChange: (value: string) => void;
  onReportTypeChange: (value: FlexeposReportType) => void;
  onRetryStore: (storeNumber: string) => void;
  onStartDateInputChange: (value: string) => void;
  onStart: () => void;
  retryDisabled: boolean;
}) {
  const selectedReportLabel = getFlexeposReportLabel(reportType);

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <SectionHeader title="Site Scraper">
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          <Chip label={selectedReportLabel} size="small" />
          <Chip label={`${scrapeSummary.total} stores`} size="small" />
          <Chip label={`${scrapeProgress.percent}% complete`} size="small" />
          <Chip label={`${scrapeSummary.rows} rows`} size="small" />
          <Chip label={`${scrapeSummary.sections} section(s)`} size="small" />
        </Box>
      </SectionHeader>
      <Divider />
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ alignItems: { xs: "stretch", md: "flex-start" } }}
        >
          <Box sx={{ minWidth: { xs: 0, md: 260 } }}>
            <ToggleButtonGroup
              aria-label="Report type"
              disabled={scrapeStatus === "running"}
              exclusive
              fullWidth
              onChange={(_, value: FlexeposReportType | null) => {
                if (value) {
                  onReportTypeChange(value);
                }
              }}
              size="small"
              value={reportType}
            >
              {reportOptions.map((option) => (
                <ToggleButton
                  key={option.type}
                  sx={{ px: 1.5, whiteSpace: "nowrap" }}
                  value={option.type}
                >
                  {option.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
          <Stack
            direction={{ xs: "column", sm: "row", md: "column", lg: "row" }}
            spacing={1.5}
            sx={{ flex: 1, maxWidth: { lg: 520 } }}
          >
            <TextField
              error={hasInvalidDateRange}
              label="Start Date"
              onChange={(event) => onStartDateInputChange(event.target.value)}
              required
              slotProps={{
                htmlInput: {
                  max: endDateInput || undefined,
                },
                inputLabel: {
                  shrink: true,
                },
              }}
              sx={{ minWidth: 160 }}
              type="date"
              value={startDateInput}
            />
            <TextField
              error={hasInvalidDateRange}
              helperText={hasInvalidDateRange ? "End date is before start date." : " "}
              label="End Date"
              onChange={(event) => onEndDateInputChange(event.target.value)}
              required
              slotProps={{
                htmlInput: {
                  min: startDateInput || undefined,
                },
                inputLabel: {
                  shrink: true,
                },
              }}
              sx={{ minWidth: 160 }}
              type="date"
              value={endDateInput}
            />
          </Stack>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            <Button
              color="secondary"
              disabled={
                scrapeStatus === "running" ||
                !startDateInput ||
                !endDateInput ||
                hasInvalidDateRange
              }
              onClick={onStart}
              startIcon={<ScrapeIcon />}
              variant="contained"
            >
              {scrapeStatus === "running" ? "Scraping" : "Start Scrape"}
            </Button>
          </Box>
        </Stack>
      </Box>
      {scrapeStatus === "running" ? (
        <Box>
          <LinearProgress
            value={scrapeProgress.percent}
            variant={scrapeProgress.total > 0 ? "determinate" : "indeterminate"}
          />
          {scrapeProgress.total > 0 ? (
            <Box sx={{ px: 2, py: 1, color: "text.secondary" }}>
              <Typography variant="body2">
                {scrapeProgress.completed} of {scrapeProgress.total} stores
                completed
              </Typography>
            </Box>
          ) : null}
        </Box>
      ) : null}
      {scrapeRun ? (
        <>
          <Divider />
          <Box sx={{ p: 2 }}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1.5}
              sx={{
                alignItems: { xs: "flex-start", md: "center" },
                justifyContent: "space-between",
              }}
            >
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                <Chip label={`Run ${scrapeRun.run_id}`} />
                <Chip
                  label={`${scrapeProgress.completed}/${scrapeProgress.total} complete`}
                />
                <Chip label={`${scrapeSummary.done} done`} color="success" />
                <Chip label={`${scrapeSummary.failed} failed`} color="warning" />
              </Box>
              <Chip
                color={
                  scrapeRun.status === "completed_with_errors"
                    ? "warning"
                    : scrapeRun.status === "running"
                      ? "primary"
                      : "success"
                }
                icon={
                  scrapeRun.status === "completed_with_errors" ? (
                    <WarningIcon />
                  ) : scrapeRun.status === "running" ? (
                    <ScrapeIcon />
                  ) : (
                    <CheckCircleIcon />
                  )
                }
                label={
                  scrapeRun.status === "completed_with_errors"
                    ? "Completed with errors"
                    : scrapeRun.status === "running"
                      ? "Scrape running"
                    : "Scrape complete"
                }
                variant="outlined"
              />
            </Stack>
          </Box>
          <ScrapeStoreTable
            retryDisabled={retryDisabled}
            stores={scrapeRun.store_results}
            onRetryStore={onRetryStore}
          />
        </>
      ) : null}
    </Paper>
  );
}

function ScrapeStoreTable({
  retryDisabled,
  stores,
  onRetryStore,
}: {
  retryDisabled: boolean;
  stores: PayrollScrapeStoreResult[];
  onRetryStore: (storeNumber: string) => void;
}) {
  return (
    <TableContainer sx={{ maxHeight: 300 }}>
      <Table stickyHeader size="small" aria-label="Store scrape queue">
        <TableHead>
          <TableRow>
            <TableCell>Store</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Rows</TableCell>
            <TableCell align="right">Sections</TableCell>
            <TableCell>Notes</TableCell>
            <TableCell align="right">Action</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {stores.map((store) => (
            <TableRow key={store.store_number}>
              <TableCell>{store.store_number}</TableCell>
              <TableCell>
                <Chip
                  color={getScrapeStatusColor(store.status)}
                  label={getScrapeStatusLabel(store.status)}
                  size="small"
                  variant={store.status === "done" ? "outlined" : "filled"}
                />
              </TableCell>
              <TableCell align="right">{store.rows}</TableCell>
              <TableCell align="right">{store.sections}</TableCell>
              <TableCell sx={{ color: "text.secondary" }}>
                {getScrapeStoreNote(store)}
              </TableCell>
              <TableCell align="right">
                {store.status === "error" ? (
                  <Button
                    disabled={retryDisabled}
                    onClick={() => onRetryStore(store.store_number)}
                    size="small"
                    startIcon={<RetryIcon />}
                    variant="outlined"
                  >
                    Retry
                  </Button>
                ) : (
                  "-"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

type ScrapedHtmlStoreResult = PayrollScrapeStoreResult & {
  scraped_html: string;
};

function ScrapedHtmlPanel({ stores }: { stores: PayrollScrapeStoreResult[] }) {
  const [selectedStoreNumber, setSelectedStoreNumber] = useState<string | false>(
    false,
  );
  const htmlStores = stores.filter(
    (store): store is ScrapedHtmlStoreResult =>
      typeof store.scraped_html === "string" && store.scraped_html.length > 0,
  );
  const activeStore =
    htmlStores.find((store) => store.store_number === selectedStoreNumber) ??
    htmlStores[0] ??
    null;
  const activeStoreNumber = activeStore?.store_number ?? false;

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <SectionHeader title="Scraped HTML">
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          <Chip label={`${htmlStores.length} store(s)`} size="small" />
          {activeStore ? (
            <Chip
              label={formatCharacterCount(activeStore.scraped_html.length)}
              size="small"
            />
          ) : null}
        </Box>
      </SectionHeader>
      <Divider />
      {htmlStores.length > 0 ? (
        <>
          <Tabs
            allowScrollButtonsMobile
            onChange={(_, value: string) => setSelectedStoreNumber(value)}
            scrollButtons="auto"
            sx={{ borderBottom: 1, borderColor: "divider", px: 1 }}
            value={activeStoreNumber}
            variant="scrollable"
          >
            {htmlStores.map((store) => (
              <Tab
                key={store.store_number}
                label={`Store ${store.store_number}`}
                value={store.store_number}
              />
            ))}
          </Tabs>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              minHeight: 260,
              maxHeight: 520,
              overflow: "auto",
              bgcolor: "#101820",
              color: "#dbeafe",
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              fontSize: "0.78rem",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {activeStore?.scraped_html}
          </Box>
        </>
      ) : (
        <Box sx={{ p: 2, color: "text.secondary" }}>
          No scraped HTML returned.
        </Box>
      )}
    </Paper>
  );
}

function PayloadTable({
  reportType,
  rows,
}: {
  reportType: FlexeposReportType;
  rows: ScrapePayload[];
}) {
  if (reportType === "tip-breakdown-report") {
    const tipRows = rows.filter(isTipBreakdownPayload);

    return (
      <TableContainer sx={{ maxHeight: 580 }}>
        <Table stickyHeader size="small" aria-label="Tip breakdown payload rows">
          <TableHead>
            <TableRow>
              <TableCell>Store Number</TableCell>
              <TableCell align="right">Total Pay-Ins</TableCell>
              <TableCell align="right">Total Tips</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tipRows.map((row, index) => (
              <TableRow key={`${row.store_number ?? "store"}-${index}`}>
                <TableCell>{formatNullable(row.store_number)}</TableCell>
                <TableCell align="right">
                  {formatAmount(row.total_payins)}
                </TableCell>
                <TableCell align="right">{formatAmount(row.total_tips)}</TableCell>
              </TableRow>
            ))}
            {tipRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} sx={{ color: "text.secondary" }}>
                  No payload rows loaded.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  const payrollRows = rows.filter(isPayrollPayload);

  return (
    <TableContainer sx={{ maxHeight: 580 }}>
      <Table stickyHeader size="small" aria-label="Payroll payload rows">
        <TableHead>
          <TableRow>
            <TableCell>Employee ID</TableCell>
            <TableCell>Employee Number</TableCell>
            <TableCell>Store Number</TableCell>
            <TableCell align="right">Regular Hours</TableCell>
            <TableCell align="right">Overtime Hours</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {payrollRows.map((row, index) => (
            <TableRow key={`${row.employee_id ?? "employee"}-${index}`}>
              <TableCell>{formatNullable(row.employee_id)}</TableCell>
              <TableCell>{formatNullable(row.employee_number)}</TableCell>
              <TableCell>{formatNullable(row.store_number)}</TableCell>
              <TableCell align="right">{formatNullable(row.regular_hours)}</TableCell>
              <TableCell align="right">{formatNullable(row.overtime_hours)}</TableCell>
            </TableRow>
          ))}
          {payrollRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} sx={{ color: "text.secondary" }}>
                No payload rows loaded.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function isPayrollPayload(row: ScrapePayload): row is PayrollPayload {
  return "regular_hours" in row || "overtime_hours" in row;
}

function isTipBreakdownPayload(row: ScrapePayload): row is TipBreakdownPayload {
  return "total_payins" in row || "total_tips" in row;
}

function sumHours(rows: PayrollPayload[], key: "regular_hours" | "overtime_hours") {
  return rows.reduce((total, row) => total + (row[key] ?? 0), 0);
}

function sumTipAmount(
  rows: TipBreakdownPayload[],
  key: "total_payins" | "total_tips",
) {
  return rows.reduce((total, row) => total + row[key], 0);
}

function formatNullable(value: number | string | null) {
  return value === null ? "-" : value.toString();
}

function formatAmount(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function formatHours(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

function formatCharacterCount(value: number) {
  return `${value.toLocaleString()} chars`;
}

function createClientRunId() {
  const suffix =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

  return `scrape_${suffix}`;
}

async function readApiError(response: Response) {
  try {
    const body = (await response.json()) as { error?: unknown };

    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    return `Request failed with ${response.status}.`;
  }

  return `Request failed with ${response.status}.`;
}

function getScrapeStatusLabel(status: PayrollScrapeStoreResult["status"]) {
  switch (status) {
    case "queued":
      return "Queued";
    case "scraping":
      return "Scraping";
    case "parsing":
      return "Parsing";
    case "done":
      return "Done";
    case "error":
      return "Error";
  }
}

function getScrapeStatusColor(
  status: PayrollScrapeStoreResult["status"],
): "default" | "primary" | "success" | "error" | "warning" {
  switch (status) {
    case "queued":
      return "default";
    case "scraping":
    case "parsing":
      return "primary";
    case "done":
      return "success";
    case "error":
      return "error";
  }
}

function getScrapeStoreNote(store: PayrollScrapeStoreResult) {
  if (store.error) {
    return store.error;
  }

  if (store.warnings.length > 0) {
    return store.warnings.join(" ");
  }

  if (store.rows === 0) {
    return "No report rows found";
  }

  return "Parsed immediately after scrape";
}

function SaveIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M17 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4ZM12 19a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM6 5h9v4H6V5Z" />
    </SvgIcon>
  );
}

function ScrapeIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M9.5 3a6.5 6.5 0 0 1 5.17 10.44l5.45 5.44-1.41 1.41-5.45-5.44A6.5 6.5 0 1 1 9.5 3Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
      <path d="M8 8h3v2H8V8Z" />
    </SvgIcon>
  );
}

function DownloadIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M11 4h2v8.17l3.59-3.58L18 10l-6 6-6-6 1.41-1.41L11 12.17V4Z" />
      <path d="M5 18h14v2H5v-2Z" />
    </SvgIcon>
  );
}

function CopyIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1Z" />
      <path d="M8 5h12c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H8c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2Zm0 2v14h12V7H8Z" />
    </SvgIcon>
  );
}

function CheckCircleIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.1 14.1-4-4 1.4-1.4 2.6 2.6 5.8-5.8 1.4 1.4-7.2 7.2Z" />
    </SvgIcon>
  );
}

function WarningIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z" />
    </SvgIcon>
  );
}

function RetryIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.45 10.9l-1.86-.74A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h8V3l-3.35 3.35Z" />
    </SvgIcon>
  );
}

function ClearIcon(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM8 9h8v10H8V9Zm7.5-5-1-1h-5l-1 1H5v2h14V4h-3.5Z" />
    </SvgIcon>
  );
}
