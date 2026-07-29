"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  SvgIcon,
  type SvgIconProps,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";

import {
  checkpointFromFailure,
  loadSalesCheckpoints,
  saveSalesCheckpoint,
  type SalesCheckpoint,
} from "@/lib/salesCheckpoints";
import {
  SALES_CATEGORY_ORDER,
  createSalesJobs,
  salesJobKey,
  summarizeSalesRows,
  type SalesComparisonRow,
  type SalesJob,
  type SalesOrganization,
} from "@/lib/salesReport";
import {
  loadRoyaltyCheckpoints,
  royaltyFailure,
  saveRoyaltyCheckpoint,
  type RoyaltyCheckpoint,
} from "@/lib/royaltyCheckpoints";
import {
  ROYALTY_CATEGORY_ORDER,
  createRoyaltyJobs,
  royaltyJobKey,
  type RoyaltyJob,
  type RoyaltyRow,
} from "@/lib/royaltyReport";
import { buildFinancialExport } from "@/lib/financialExport";
import { financialStores } from "@/lib/financialStores";
import {
  createFinancialRun,
  deleteFinancialRun,
  loadFinancialRuns,
  saveFinancialRun,
  type FinancialRun,
} from "@/lib/financialRuns";

const SALES_JOBS_PER_SESSION = 3;
const ROYALTY_JOBS_PER_SESSION = 6;
const MAX_ATTEMPTS = 2;
const PAGE_SIZE = 200;
const ACTIVITY_PAGE_SIZE = 50;

type SalesStreamEvent = {
  type: string;
  key?: string;
  job?: SalesJob;
  rows?: SalesComparisonRow[];
  error?: string;
};

type DisplaySalesRow = SalesComparisonRow & {
  balance_status: string;
  is_summary: boolean;
};
type RoyaltyStreamEvent = { type: string; key?: string; job?: RoyaltyJob; rows?: RoyaltyRow[]; error?: string };
type JobActivity = {
  key: string;
  period: string;
  store: string;
  attempt: number;
  status: "Queued" | "Scraping" | "Completed" | "Failed";
  updated_at: number;
  error?: string;
};

export function FinancialWorkspace() {
  const [activeTab, setActiveTab] = useState<"sales" | "royalties">("sales");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [organization, setOrganization] = useState<SalesOrganization>("century");
  const [checkpoints, setCheckpoints] = useState<Record<string, SalesCheckpoint>>({});
  const [royaltyCheckpoints, setRoyaltyCheckpoints] = useState<Record<string, RoyaltyCheckpoint>>({});
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [totalJobs, setTotalJobs] = useState(0);
  const [royaltyTotalJobs, setRoyaltyTotalJobs] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [activity, setActivity] = useState<Record<string, JobActivity>>({});
  const [salesRun, setSalesRun] = useState<FinancialRun | null>(null);
  const [royaltyRun, setRoyaltyRun] = useState<FinancialRun | null>(null);
  const [runHistory, setRunHistory] = useState<FinancialRun[]>([]);
  const pauseRequested = useRef(false);
  const cancelRequested = useRef(false);
  const activeControllers = useRef(new Set<AbortController>());
  const invalidRange = Boolean(startDate && endDate && startDate > endDate);
  const activeRun = activeTab === "sales" ? salesRun : royaltyRun;

  useEffect(() => {
    void refreshRunHistory();
  }, []);

  async function refreshRunHistory() {
    const [sales, royalties] = await Promise.all([
      loadFinancialRuns("sales"),
      loadFinancialRuns("royalties"),
    ]);
    setRunHistory([...sales, ...royalties]);
  }

  function navigateToReport(report: "sales" | "royalties") {
    setActiveTab(report);
  }

  const records = Object.values(checkpoints);
  const detailRows = useMemo(
    () => records
      .filter((record) => record.status === "completed")
      .flatMap((record) => record.rows)
      .sort((left, right) =>
        left.date.localeCompare(right.date) ||
        left.store.localeCompare(right.store, undefined, { numeric: true }) ||
        SALES_CATEGORY_ORDER.indexOf(left.transaction_category as never) -
          SALES_CATEGORY_ORDER.indexOf(right.transaction_category as never),
      ),
    [records],
  );
  const summaries = useMemo(
    () => records
      .filter((record) => record.status === "completed")
      .map((record) =>
        summarizeSalesRows(record.rows)[0] ?? {
          balance_status: "Balanced",
          date: record.business_date,
          difference: 0,
          store: record.store_number,
          total_credit: 0,
          total_debit: 0,
        },
      )
      .sort((left, right) =>
        left.date.localeCompare(right.date) ||
        left.store.localeCompare(right.store, undefined, { numeric: true }),
      ),
    [records],
  );
  const displayRows = useMemo(() => {
    const rowsByKey = new Map<string, SalesComparisonRow[]>();
    for (const row of detailRows) {
      const key = `${row.date}|${row.store}`;
      rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
    }

    return summaries.flatMap<DisplaySalesRow>((summary) => [
      ...(rowsByKey.get(`${summary.date}|${summary.store}`) ?? []).map((row) => ({
        ...row,
        balance_status: "",
        is_summary: false,
      })),
      {
        balance_status: summary.balance_status,
        credit: summary.total_credit || null,
        date: summary.date,
        debit: summary.total_debit || null,
        is_summary: true,
        store: summary.store,
        transaction_category: "SUMMARY",
      },
    ]);
  }, [detailRows, summaries]);
  const royaltyRecords = Object.values(royaltyCheckpoints);
  const royaltyDetailRows = useMemo(() => royaltyRecords
    .filter((record) => record.status === "completed").flatMap((record) => record.rows)
    .sort((left, right) => left.store.localeCompare(right.store, undefined, { numeric: true }) ||
      ROYALTY_CATEGORY_ORDER.indexOf(left.transaction_category as never) - ROYALTY_CATEGORY_ORDER.indexOf(right.transaction_category as never)),
  [royaltyRecords]);
  const royaltyDisplayRows = useMemo<DisplaySalesRow[]>(() => royaltyRecords
    .filter((record) => record.status === "completed")
    .sort((left, right) => left.store_number.localeCompare(right.store_number, undefined, { numeric: true }))
    .flatMap((record) => {
      const debit = Math.round(record.rows.reduce((sum, row) => sum + (row.debit ?? 0), 0) * 100) / 100;
      const credit = Math.round(record.rows.reduce((sum, row) => sum + (row.credit ?? 0), 0) * 100) / 100;
      const difference = Math.round((debit - credit) * 100) / 100;
      return [
        ...record.rows.map((row) => ({ ...row, balance_status: "", is_summary: false })),
        { balance_status: difference === 0 ? "Balanced" : `${difference > 0 ? "Debit" : "Credit"} +${money(Math.abs(difference))}`,
          credit: credit || null, date: `${record.start_date} - ${record.end_date}`, debit: debit || null,
          is_summary: true, store: record.store_number, transaction_category: "SUMMARY" },
      ];
    }), [royaltyRecords]);
  const activeRecords = activeTab === "sales" ? records : royaltyRecords;
  const activeDisplayRows = activeTab === "sales" ? displayRows : royaltyDisplayRows;
  const activeDetailRows = activeTab === "sales" ? detailRows : royaltyDetailRows;
  const activeTotalJobs = activeTab === "sales" ? totalJobs : royaltyTotalJobs;
  const visibleRunHistory = [
    ...(activeRun && !runHistory.some((run) => run.id === activeRun.id) ? [activeRun] : []),
    ...runHistory.filter((run) => run.report_type === activeTab),
  ];
  const failedCount = activeRecords.filter((record) => record.status === "failed").length;
  const completedCount = activeRecords.filter((record) => record.status === "completed").length;
  const progress = activeTotalJobs ? Math.round((completedCount / activeTotalJobs) * 100) : 0;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredRows = activeDisplayRows.filter((row) =>
    [row.date, row.store, row.transaction_category, row.debit, row.credit, row.balance_status]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch),
  );
  const visibleRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  async function startSalesScrape(mode: "new" | "resume" | "failed" = "new") {
    if (!startDate || !endDate || invalidRange || running) return;
    let run: FinancialRun;
    const resumable = salesRun &&
      salesRun.organization === organization &&
      salesRun.start_date === startDate &&
      salesRun.end_date === endDate;
    if (mode === "new" || !resumable) {
      run = createFinancialRun("sales", organization, startDate, endDate);
      setSalesRun(run);
      setCheckpoints({});
      setActivity({});
    } else {
      run = { ...salesRun, status: "running", updated_at: new Date().toISOString() };
      setSalesRun(run);
    }
    await saveFinancialRun(run);
    let expectedJobs = 0;
    setRunning(true);
    setPaused(false);
    pauseRequested.current = false;
    cancelRequested.current = false;
    setRunError(null);
    setPage(0);

    try {
      const existing = mode === "new" ? [] : await loadSalesCheckpoints(run.id);
      setCheckpoints(Object.fromEntries(existing.map((record) => [record.key, record])));
      const completedJobs = Object.fromEntries(existing.map((record) => [
        salesJobKey(record),
        record,
      ]));
      const allJobs = createSalesJobs({
        endDate,
        organization,
        startDate,
        stores: [...financialStores(organization)],
      });
      expectedJobs = allJobs.length;
      setTotalJobs(allJobs.length);
      const pending = allJobs.filter((job) => {
        const record = completedJobs[salesJobKey(job)];
        return mode === "failed" ? record?.status === "failed" : record?.status !== "completed";
      });
      await runTwoSessionQueue(pending.map((job) => ({ ...job, attempts: 0 })), run.id);
    } catch (caught) {
      setRunError(caught instanceof Error ? caught.message : "Unable to run the sales scrape.");
    } finally {
      const saved = await loadSalesCheckpoints(run.id);
      const status = cancelRequested.current
        ? "cancelled"
        : pauseRequested.current
          ? "paused"
          : saved.length < expectedJobs || saved.some((record) => record.status === "failed")
            ? "completed_with_errors"
            : "completed";
      run = { ...run, status, updated_at: new Date().toISOString() };
      await saveFinancialRun(run);
      setSalesRun(run);
      await refreshRunHistory();
      setRunning(false);
    }
  }

  async function startRoyaltyScrape(mode: "new" | "resume" | "failed" = "new") {
    if (!startDate || !endDate || invalidRange || running) return;
    let run: FinancialRun;
    const resumable = royaltyRun &&
      royaltyRun.organization === organization &&
      royaltyRun.start_date === startDate &&
      royaltyRun.end_date === endDate;
    if (mode === "new" || !resumable) {
      run = createFinancialRun("royalties", organization, startDate, endDate);
      setRoyaltyRun(run);
      setRoyaltyCheckpoints({});
      setActivity({});
    } else {
      run = { ...royaltyRun, status: "running", updated_at: new Date().toISOString() };
      setRoyaltyRun(run);
    }
    await saveFinancialRun(run);
    let expectedJobs = 0;
    setRunning(true); setRunError(null); setPage(0); setPaused(false);
    pauseRequested.current = false; cancelRequested.current = false;
    try {
      const existing = mode === "new" ? [] : await loadRoyaltyCheckpoints(run.id);
      setRoyaltyCheckpoints(Object.fromEntries(existing.map((record) => [record.key, record])));
      const existingMap = Object.fromEntries(existing.map((record) => [royaltyJobKey(record), record]));
      const allJobs = createRoyaltyJobs({
        organization,
        startDate,
        endDate,
        stores: [...financialStores(organization)],
      });
      expectedJobs = allJobs.length;
      setRoyaltyTotalJobs(allJobs.length);
      const queue = allJobs.filter((job) => {
        const record = existingMap[royaltyJobKey(job)];
        return mode === "failed" ? record?.status === "failed" : record?.status !== "completed";
      }).map((job) => ({ ...job, attempts: 0 }));
      await runRoyaltyQueue(queue, run.id);
    } catch (caught) {
      setRunError(caught instanceof Error ? caught.message : "Unable to run royalties scrape.");
    } finally {
      const saved = await loadRoyaltyCheckpoints(run.id);
      const status = cancelRequested.current
        ? "cancelled"
        : pauseRequested.current
          ? "paused"
          : saved.length < expectedJobs || saved.some((record) => record.status === "failed")
            ? "completed_with_errors"
            : "completed";
      run = { ...run, status, updated_at: new Date().toISOString() };
      await saveFinancialRun(run);
      setRoyaltyRun(run);
      await refreshRunHistory();
      setRunning(false);
    }
  }

  async function runRoyaltyQueue(initial: RoyaltyJob[], runId: string) {
    const queue = [...initial];
    async function worker() {
      while (queue.length && !pauseRequested.current && !cancelRequested.current) {
        const jobs = queue.splice(0, ROYALTY_JOBS_PER_SESSION).map((job) => ({ ...job, attempts: job.attempts + 1 }));
        markJobsQueued(jobs);
        const settled = new Set<string>();
        const controller = new AbortController();
        activeControllers.current.add(controller);
        try {
          await streamSession<RoyaltyJob, RoyaltyStreamEvent>("/api/royalties-scrape", jobs, async (event) => {
            if (!event.job || !event.key) return;
            markActivity(event.key, event.job, event.type, event.error);
            if (event.type === "job_started") return;
            settled.add(event.key);
            if (event.type === "job_completed") {
              const row: RoyaltyCheckpoint = { attempts: event.job.attempts, end_date: event.job.end_date, key: `${runId}|${event.key}`,
                organization: event.job.organization, rows: event.rows ?? [], start_date: event.job.start_date,
                run_id: runId, status: "completed", store_number: event.job.store_number };
              await saveRoyaltyCheckpoint(row); setRoyaltyCheckpoints((current) => ({ ...current, [row.key]: row }));
            } else if (event.type === "job_failed") await retryRoyalty(event.job, event.error ?? "Royalty scrape failed.", queue, runId);
          }, controller.signal);
        } catch (caught) { if (!cancelRequested.current) setRunError(caught instanceof Error ? caught.message : "A royalty session disconnected."); }
        finally { activeControllers.current.delete(controller); }
        if (cancelRequested.current) return;
        for (const job of jobs) if (!settled.has(royaltyJobKey(job))) await retryRoyalty(job, "Browser session ended before this job completed.", queue, runId);
      }
    }
    await Promise.all([worker(), worker()]);
  }

  async function retryRoyalty(job: RoyaltyJob, error: string, queue: RoyaltyJob[], runId: string) {
    if (job.attempts < MAX_ATTEMPTS) { queue.push(job); return; }
    const row = royaltyFailure(job, error, runId); await saveRoyaltyCheckpoint(row);
    setRoyaltyCheckpoints((current) => ({ ...current, [row.key]: row }));
  }

  function pauseScrape() {
    pauseRequested.current = true;
    setPaused(true);
  }

  function cancelScrape() {
    cancelRequested.current = true;
    pauseRequested.current = true;
    setPaused(false);
    for (const controller of activeControllers.current) controller.abort();
  }

  function markJobsQueued(jobs: Array<SalesJob | RoyaltyJob>) {
    setActivity((current) => ({
      ...current,
      ...Object.fromEntries(jobs.map((job) => {
        const key = "business_date" in job ? salesJobKey(job) : royaltyJobKey(job);
        return [key, activityFromJob(key, job, "Queued")];
      })),
    }));
  }

  function markActivity(key: string, job: SalesJob | RoyaltyJob, type: string, error?: string) {
    const status = type === "job_started" ? "Scraping" : type === "job_completed" ? "Completed" : "Failed";
    setActivity((current) => ({ ...current, [key]: { ...activityFromJob(key, job, status), error } }));
  }

  async function runTwoSessionQueue(initialJobs: SalesJob[], runId: string) {
    const queue = [...initialJobs];

    async function worker() {
      while (queue.length > 0 && !pauseRequested.current && !cancelRequested.current) {
        const jobs = queue.splice(0, SALES_JOBS_PER_SESSION).map((job) => ({
          ...job,
          attempts: job.attempts + 1,
        }));
        markJobsQueued(jobs);
        const settled = new Set<string>();
        const controller = new AbortController();
        activeControllers.current.add(controller);
        try {
          await streamSalesSession(jobs, async (event) => {
            if (!event.job || !event.key) return;
            markActivity(event.key, event.job, event.type, event.error);
            if (event.type === "job_started") return;
            settled.add(event.key);
            if (event.type === "job_completed") {
              const checkpoint: SalesCheckpoint = {
                attempts: event.job.attempts,
                business_date: event.job.business_date,
                key: `${runId}|${event.key}`,
                organization: event.job.organization,
                rows: event.rows ?? [],
                run_id: runId,
                status: "completed",
                store_number: event.job.store_number,
              };
              await persistCheckpoint(checkpoint);
            } else if (event.type === "job_failed") {
              await retryOrFail(event.job, event.error ?? "Sales scrape failed.", queue, runId);
            }
          }, controller.signal);
        } catch (caught) {
          if (!cancelRequested.current) setRunError(caught instanceof Error ? caught.message : "A sales session disconnected.");
        } finally {
          activeControllers.current.delete(controller);
        }
        if (cancelRequested.current) return;
        for (const job of jobs) {
          if (!settled.has(salesJobKey(job))) {
            await retryOrFail(job, "Browser session ended before this job completed.", queue, runId);
          }
        }
      }
    }

    await Promise.all([worker(), worker()]);
  }

  async function retryOrFail(job: SalesJob, error: string, queue: SalesJob[], runId: string) {
    if (job.attempts < MAX_ATTEMPTS) {
      queue.push(job);
      return;
    }
    await persistCheckpoint(checkpointFromFailure(job, error, runId));
  }

  async function persistCheckpoint(checkpoint: SalesCheckpoint) {
    await saveSalesCheckpoint(checkpoint);
    setCheckpoints((current) => ({ ...current, [checkpoint.key]: checkpoint }));
  }

  async function openPreviousRun(runId: string) {
    const run = runHistory.find((item) => item.id === runId);
    if (!run || running) return;
    setOrganization(run.organization);
    setStartDate(run.start_date);
    setEndDate(run.end_date);
    setActivity({});
    setPaused(run.status === "paused");
    setRunError(null);

    if (run.report_type === "sales") {
      const saved = await loadSalesCheckpoints(run.id);
      setSalesRun(run);
      setCheckpoints(Object.fromEntries(saved.map((record) => [record.key, record])));
      setActivity(Object.fromEntries(saved.map((record) => {
        const key = salesJobKey(record);
        return [key, {
          attempt: record.attempts,
          error: record.error,
          key,
          period: record.business_date,
          status: record.status === "failed" ? "Failed" : "Completed",
          store: record.store_number,
          updated_at: 0,
        } satisfies JobActivity];
      })));
      setTotalJobs(createSalesJobs({
        organization: run.organization,
        startDate: run.start_date,
        endDate: run.end_date,
        stores: [...financialStores(run.organization)],
      }).length);
    } else {
      const saved = await loadRoyaltyCheckpoints(run.id);
      setRoyaltyRun(run);
      setRoyaltyCheckpoints(Object.fromEntries(saved.map((record) => [record.key, record])));
      setActivity(Object.fromEntries(saved.map((record) => {
        const key = royaltyJobKey(record);
        return [key, {
          attempt: record.attempts,
          error: record.error,
          key,
          period: `${record.start_date} - ${record.end_date}`,
          status: record.status === "failed" ? "Failed" : "Completed",
          store: record.store_number,
          updated_at: 0,
        } satisfies JobActivity];
      })));
      setRoyaltyTotalJobs(createRoyaltyJobs({
        organization: run.organization,
        startDate: run.start_date,
        endDate: run.end_date,
        stores: [...financialStores(run.organization)],
      }).length);
    }
  }

  async function removeRun(run: FinancialRun) {
    if (running || !window.confirm(`Delete the ${run.report_type} run from ${run.start_date} to ${run.end_date}?`)) return;
    await deleteFinancialRun(run.id);
    if (salesRun?.id === run.id) {
      setSalesRun(null);
      setCheckpoints({});
      setTotalJobs(0);
    }
    if (royaltyRun?.id === run.id) {
      setRoyaltyRun(null);
      setRoyaltyCheckpoints({});
      setRoyaltyTotalJobs(0);
    }
    setPaused(false);
    setActivity({});
    await refreshRunHistory();
  }

  function download(format: "csv" | "json") {
    const content =
      format === "json"
        ? JSON.stringify(buildFinancialExport({
            reportType: activeTab,
            organization,
            runId: activeRun?.id,
            startDate,
            endDate,
            rows: activeDisplayRows,
          }), null, 2)
        : toCsv(activeDisplayRows);
    const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `flexepos_${activeTab}_${startDate}_${endDate}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography component="h1" variant="h1">Financial</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75 }}>Run and review Flexepos financial reports.</Typography>
      </Box>
      <Paper variant="outlined" sx={{ minWidth: 0, overflow: "hidden" }}>
        <Tabs value={activeTab} onChange={(_, value: "sales" | "royalties") => navigateToReport(value)} sx={{ px: 2 }}>
          <Tab label="Sales" value="sales" />
          <Tab label="Royalties" value="royalties" />
        </Tabs>
        <Divider />
        <Box sx={{ p: { xs: 2, md: 3 } }}>
          <Stack spacing={3} sx={{ alignItems: "stretch" }}>
          <Stack spacing={2.5} sx={{ flex: 1.15, minWidth: 0 }}>
            <Typography component="h2" variant="h2">
              {activeTab === "sales" ? "Sales Report" : "Royalties Report"}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
              <FormControl size="small" sx={{ width: { xs: "100%", sm: 360 } }}>
                <InputLabel id="financial-run-history">Previous Runs</InputLabel>
                <Select
                  labelId="financial-run-history"
                  label="Previous Runs"
                  value={activeRun?.id ?? ""}
                  disabled={running}
                  onChange={(event) => void openPreviousRun(event.target.value)}
                >
                  {visibleRunHistory.map((run) => (
                    <MenuItem key={run.id} value={run.id}>
                      {run.start_date} – {run.end_date} · {run.organization} · {run.status.replaceAll("_", " ")}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                size="small"
                color="error"
                variant="outlined"
                disabled={running || !activeRun}
                onClick={() => activeRun && void removeRun(activeRun)}
              >
                Delete Run
              </Button>
            </Stack>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "flex-start" }}>
              <TextField size="small" label="Start Date" type="date" required value={startDate} error={invalidRange} sx={{ width: { xs: "100%", sm: 165 } }}
                onChange={(event) => setStartDate(event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: endDate || undefined } }} />
              <TextField size="small" label="End Date" type="date" required value={endDate} error={invalidRange} sx={{ width: { xs: "100%", sm: 165 } }}
                helperText={invalidRange ? "End date is before start date." : " "}
                onChange={(event) => setEndDate(event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: startDate || undefined } }} />
              <FormControl size="small" sx={{ width: { xs: "100%", sm: 190 } }}>
                <InputLabel id="financial-org">Organization</InputLabel>
                <Select labelId="financial-org" label="Organization" value={organization}
                  onChange={(event) => setOrganization(event.target.value as SalesOrganization)}>
                  <MenuItem value="century">Century</MenuItem>
                  <MenuItem value="century_austin">Century Austin</MenuItem>
                </Select>
              </FormControl>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <Button size="small" variant="contained" color={running ? "warning" : "secondary"} sx={{ minHeight: 40, px: 2 }}
                  disabled={(running && paused) || (!running && (!startDate || !endDate || invalidRange))}
                  startIcon={running ? <PauseIcon /> : <PlayIcon />}
                  onClick={() => running
                    ? pauseScrape()
                    : activeTab === "sales"
                      ? startSalesScrape(paused ? "resume" : "new")
                      : startRoyaltyScrape(paused ? "resume" : "new")}>
                {running ? (paused ? "Pausing…" : "Pause") : "Start Scrape"}
              </Button>
              <Button size="small" variant="outlined" sx={{ minHeight: 40 }} disabled={running || failedCount === 0}
                onClick={() => activeTab === "sales" ? startSalesScrape("failed") : startRoyaltyScrape("failed")}>Retry Failed</Button>
                <Button size="small" variant="text" sx={{ minHeight: 40 }} disabled={running || !startDate || !endDate || invalidRange}
                  onClick={() => activeTab === "sales" ? startSalesScrape("new") : startRoyaltyScrape("new")}>Reload All</Button>
              <Button size="small" variant="outlined" color="error" sx={{ minHeight: 40 }} disabled={!running && !paused}
                onClick={cancelScrape}>Cancel</Button>
              </Stack>
            </Box>
            {runError ? <Alert severity="warning">{runError}</Alert> : null}
            {paused ? <Alert severity="info">Pause requested. Active sessions will finish, then Start Scrape continues from saved checkpoints.</Alert> : null}
          </Stack>
          <ActivityTable
            key={`${activeTab}-${activeRun?.id ?? "none"}`}
            completed={completedCount}
            failed={failedCount}
            progress={progress}
            rows={Object.values(activity)}
            total={activeTotalJobs}
          />
          </Stack>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ minWidth: 0, overflow: "hidden" }}>
          <Box sx={{ p: 2 }}>
            <Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} sx={{ alignItems: { lg: "center" }, justifyContent: "space-between" }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="h2">Results</Typography>
                <Chip size="small" label={`${filteredRows.length} rows`} />
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
                <TextField size="small" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }}
                  placeholder="Search date, store, category, or status" sx={{ width: { xs: "100%", sm: 340 } }}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
                <Stack direction="row" spacing={1}>
                  <Button size="small" startIcon={<DownloadIcon />} variant="outlined" disabled={!activeDetailRows.length} onClick={() => download("csv")}>CSV</Button>
                  <Button size="small" startIcon={<DownloadIcon />} variant="outlined" disabled={!activeDetailRows.length} onClick={() => download("json")}>JSON</Button>
                </Stack>
              </Stack>
            </Stack>
          </Box>
          <Divider />
          <ResultTable rows={visibleRows} />
          <Divider />
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "flex-end", p: 1.5 }}>
            <Button size="small" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <Chip label={`Page ${page + 1} of ${Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))}`} />
            <Button size="small" disabled={(page + 1) * PAGE_SIZE >= filteredRows.length} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </Stack>
      </Paper>
    </Stack>
  );
}

async function streamSalesSession(jobs: SalesJob[], onEvent: (event: SalesStreamEvent) => Promise<void>, signal?: AbortSignal) {
  return streamSession<SalesJob, SalesStreamEvent>("/api/sales-scrape", jobs, onEvent, signal);
}

async function streamSession<TJob, TEvent>(endpoint: string, jobs: TJob[], onEvent: (event: TEvent) => Promise<void>, signal?: AbortSignal) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobs }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Scrape session returned ${response.status}.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) await onEvent(JSON.parse(line) as TEvent);
    if (done) break;
  }
  if (buffer.trim()) await onEvent(JSON.parse(buffer) as TEvent);
}

function activityFromJob(
  key: string,
  job: SalesJob | RoyaltyJob,
  status: JobActivity["status"],
): JobActivity {
  return {
    attempt: job.attempts,
    key,
    period: "business_date" in job ? job.business_date : `${job.start_date} - ${job.end_date}`,
    status,
    store: job.store_number,
    updated_at: Date.now(),
  };
}

function ActivityTable({
  completed,
  failed,
  progress,
  rows,
  total,
}: {
  completed: number;
  failed: number;
  progress: number;
  rows: JobActivity[];
  total: number;
}) {
  const [statusFilter, setStatusFilter] = useState<"All" | JobActivity["status"]>("All");
  const [activityPage, setActivityPage] = useState(0);
  const statusPriority: Record<JobActivity["status"], number> = {
    Scraping: 0,
    Failed: 1,
    Queued: 2,
    Completed: 3,
  };
  const filteredActivityRows = rows
    .filter((row) => statusFilter === "All" || row.status === statusFilter)
    .sort((left, right) =>
      statusPriority[left.status] - statusPriority[right.status] ||
      right.updated_at - left.updated_at,
    );
  const activityPages = Math.max(1, Math.ceil(filteredActivityRows.length / ACTIVITY_PAGE_SIZE));
  const safeActivityPage = Math.min(activityPage, activityPages - 1);
  const visibleRows = filteredActivityRows.slice(
    safeActivityPage * ACTIVITY_PAGE_SIZE,
    (safeActivityPage + 1) * ACTIVITY_PAGE_SIZE,
  );

  return (
    <Box sx={{ minWidth: 0, borderTop: "1px solid", borderColor: "divider", pt: 3 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { xs: "stretch", sm: "center" }, justifyContent: "space-between", mb: 1.5 }}>
        <Box><Typography variant="h2">Scrape Activity</Typography><Typography variant="body2" color="text.secondary">Live store and period progress</Typography></Box>
        <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel id="activity-status-filter">Status</InputLabel>
            <Select
              label="Status"
              labelId="activity-status-filter"
              onChange={(event) => {
                setStatusFilter(event.target.value as "All" | JobActivity["status"]);
                setActivityPage(0);
              }}
              value={statusFilter}
            >
              {(["All", "Scraping", "Failed", "Queued", "Completed"] as const).map((status) => (
                <MenuItem key={status} value={status}>{status}</MenuItem>
              ))}
            </Select>
        </FormControl>
      </Stack>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 1.5 }}>
        <Chip size="small" label={`${completed}/${total || 0} completed`} color="success" />
        <Chip size="small" label={`${failed} failed`} color={failed ? "warning" : "default"} />
        <Chip size="small" label={`${progress}% complete`} />
        <Chip size="small" label={`${filteredActivityRows.length} matching`} variant="outlined" />
      </Stack>
      <TableContainer sx={{ maxHeight: 340, maxWidth: "100%", overflow: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
        <Table stickyHeader size="small" sx={{ minWidth: 560 }}>
          <TableHead><TableRow><TableCell>Date / Range</TableCell><TableCell>Store</TableCell><TableCell align="right">Attempt</TableCell><TableCell>Status</TableCell><TableCell>Notes</TableCell></TableRow></TableHead>
          <TableBody>{visibleRows.map((row) => <TableRow key={row.key}><TableCell>{row.period}</TableCell><TableCell>{row.store}</TableCell><TableCell align="right">{row.attempt}</TableCell><TableCell><Chip size="small" label={row.status} color={row.status === "Completed" ? "success" : row.status === "Failed" ? "warning" : row.status === "Scraping" ? "primary" : "default"} /></TableCell><TableCell sx={{ color: "text.secondary", maxWidth: 220 }}>{row.error ?? ""}</TableCell></TableRow>)}
            {!visibleRows.length ? <TableRow><TableCell colSpan={5} sx={{ color: "text.secondary", py: 4, textAlign: "center" }}>{rows.length ? `No ${statusFilter.toLowerCase()} jobs.` : "Activity appears here when a scrape starts."}</TableCell></TableRow> : null}</TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "flex-end", mt: 1.5 }}>
        <Button size="small" disabled={safeActivityPage === 0} onClick={() => setActivityPage((value) => Math.max(0, value - 1))}>Previous</Button>
        <Chip size="small" label={`Page ${safeActivityPage + 1} of ${activityPages}`} />
        <Button size="small" disabled={safeActivityPage + 1 >= activityPages} onClick={() => setActivityPage((value) => value + 1)}>Next</Button>
      </Stack>
    </Box>
  );
}

function ResultTable({ rows }: { rows: DisplaySalesRow[] }) {
  return <TableContainer sx={{ maxHeight: "min(620px, calc(100vh - 220px))", maxWidth: "100%", overflow: "auto" }}><Table stickyHeader size="small" sx={{ minWidth: 820 }}>
    <TableHead><TableRow><TableCell>Date</TableCell><TableCell>Store</TableCell><TableCell>Transaction Category</TableCell><TableCell align="right">Debit</TableCell><TableCell align="right">Credit</TableCell><TableCell>Balance Status</TableCell></TableRow></TableHead>
    <TableBody>{rows.map((row, index) => <TableRow key={`${row.date}-${row.store}-${row.transaction_category}-${index}`} sx={row.is_summary ? { bgcolor: "action.hover", "& td": { fontWeight: 700 } } : undefined}><TableCell>{row.date}</TableCell><TableCell>{row.store}</TableCell><TableCell>{row.transaction_category}</TableCell><TableCell align="right">{money(row.debit)}</TableCell><TableCell align="right">{money(row.credit)}</TableCell><TableCell>{row.is_summary ? <Chip size="small" color={row.balance_status === "Balanced" ? "success" : "warning"} label={row.balance_status} /> : ""}</TableCell></TableRow>)}
      {!rows.length ? <TableRow><TableCell colSpan={6} sx={{ color: "text.secondary" }}>No sales rows loaded.</TableCell></TableRow> : null}</TableBody>
  </Table></TableContainer>;
}

function money(value: number | null) {
  return value == null ? "" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function toCsv(rows: DisplaySalesRow[]) {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return ["Date,Store,Transaction Category,Debit,Credit,Balance Status", ...rows.map((row) =>
    [row.date, row.store, row.transaction_category, row.debit ?? "", row.credit ?? "", row.balance_status].map(escape).join(","),
  )].join("\n");
}

function PlayIcon(props: SvgIconProps) {
  return <SvgIcon {...props}><path d="M8 5v14l11-7z" /></SvgIcon>;
}

function PauseIcon(props: SvgIconProps) {
  return <SvgIcon {...props}><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></SvgIcon>;
}

function SearchIcon(props: SvgIconProps) {
  return <SvgIcon {...props}><path d="M9.5 3a6.5 6.5 0 1 0 3.98 11.64L18.85 20 20 18.85l-5.36-5.37A6.5 6.5 0 0 0 9.5 3m0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9" /></SvgIcon>;
}

function DownloadIcon(props: SvgIconProps) {
  return <SvgIcon {...props}><path d="M11 3h2v9l3.5-3.5 1.4 1.4-5.9 5.9-5.9-5.9 1.4-1.4L11 12zM5 19h14v2H5z" /></SvgIcon>;
}
