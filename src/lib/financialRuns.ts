import type { SalesOrganization } from "./salesReport";

export type FinancialRun = {
  id: string;
  report_type: "sales" | "royalties";
  organization: SalesOrganization;
  start_date: string;
  end_date: string;
  status: "running" | "paused" | "completed" | "completed_with_errors" | "cancelled";
  created_at: string;
  updated_at: string;
};

const DATABASE = "centech-financial";
const VERSION = 3;
const RUNS = "financial-runs";
const SALES = "sales-checkpoints";
const ROYALTIES = "royalty-checkpoints";

export function createFinancialRun(
  reportType: FinancialRun["report_type"],
  organization: SalesOrganization,
  startDate: string,
  endDate: string,
): FinancialRun {
  const now = new Date().toISOString();
  return {
    id: `${reportType}_${Date.now()}_${crypto.randomUUID()}`,
    report_type: reportType,
    organization,
    start_date: startDate,
    end_date: endDate,
    status: "running",
    created_at: now,
    updated_at: now,
  };
}

export async function saveFinancialRun(run: FinancialRun) {
  const database = await openDatabase();
  await requestToPromise(database.transaction(RUNS, "readwrite").objectStore(RUNS).put(run));
  database.close();
}

export async function loadFinancialRuns(reportType: FinancialRun["report_type"]) {
  const database = await openDatabase();
  const records = await requestToPromise<FinancialRun[]>(
    database.transaction(RUNS, "readonly").objectStore(RUNS).getAll(),
  );
  database.close();
  return records
    .filter((run) => run.report_type === reportType)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export async function deleteFinancialRun(runId: string) {
  let database = await openDatabase();
  const salesRecords = await requestToPromise<Array<{ key: string; run_id?: string }>>(
    database.transaction(SALES, "readonly").objectStore(SALES).getAll(),
  );
  const royaltyRecords = await requestToPromise<Array<{ key: string; run_id?: string }>>(
    database.transaction(ROYALTIES, "readonly").objectStore(ROYALTIES).getAll(),
  );
  database.close();

  database = await openDatabase();
  const transaction = database.transaction([RUNS, SALES, ROYALTIES], "readwrite");
  transaction.objectStore(RUNS).delete(runId);
  for (const record of salesRecords) {
    if (record.run_id === runId) transaction.objectStore(SALES).delete(record.key);
  }
  for (const record of royaltyRecords) {
    if (record.run_id === runId) transaction.objectStore(ROYALTIES).delete(record.key);
  }
  await transactionDone(transaction);
  database.close();
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      for (const storeName of [RUNS, SALES, ROYALTIES]) {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: storeName === RUNS ? "id" : "key" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
