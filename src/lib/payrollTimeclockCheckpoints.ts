import type { EmployeeTimeclockCheckpoint } from "./payrollTimeclocks";
import type { PayrollScrapeRun } from "./scrapeRuns";

export type PayrollV2RunStatus =
  | "running"
  | "paused"
  | "completed"
  | "completed_with_errors"
  | "cancelled";

export type PayrollV2RunRecord = {
  id: string;
  start_date: string;
  end_date: string;
  status: PayrollV2RunStatus;
  created_at: string;
  updated_at: string;
  elapsed_ms: number;
  run: PayrollScrapeRun;
};

const DATABASE = "centech-scrape";
const VERSION = 4;
const STORE = "payroll-timeclock-checkpoints";
const RUNS = "payroll-v2-runs";

export async function savePayrollTimeclockCheckpoint(checkpoint: EmployeeTimeclockCheckpoint) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readwrite");
  transaction.objectStore(STORE).put(checkpoint);
  await transactionDone(transaction);
  database.close();
}

export async function savePayrollV2Run(record: PayrollV2RunRecord) {
  const database = await openDatabase();
  const transaction = database.transaction(RUNS, "readwrite");
  transaction.objectStore(RUNS).put(record);
  await transactionDone(transaction);
  database.close();
}

export async function loadPayrollV2Runs() {
  const database = await openDatabase();
  const records = await requestToPromise<PayrollV2RunRecord[]>(
    database.transaction(RUNS, "readonly").objectStore(RUNS).getAll(),
  );
  database.close();
  return records.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export async function loadPayrollTimeclockCheckpoints(runId: string) {
  const database = await openDatabase();
  const records = await requestToPromise<EmployeeTimeclockCheckpoint[]>(
    database.transaction(STORE).objectStore(STORE).getAll(),
  );
  database.close();
  return records.filter((record) => record.key.startsWith(`${runId}|`));
}

export async function deletePayrollTimeclockCheckpoints(runId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readwrite");
  const objectStore = transaction.objectStore(STORE);
  const keys = await requestToPromise<IDBValidKey[]>(objectStore.getAllKeys());
  for (const key of keys) {
    if (String(key).startsWith(`${runId}|`)) objectStore.delete(key);
  }
  await transactionDone(transaction);
  database.close();
}

export async function deletePayrollV2Run(runId: string) {
  const database = await openDatabase();
  const checkpointStore = database.transaction(STORE, "readonly").objectStore(STORE);
  const keys = await requestToPromise<IDBValidKey[]>(checkpointStore.getAllKeys());
  database.close();

  const writeDatabase = await openDatabase();
  const transaction = writeDatabase.transaction([RUNS, STORE], "readwrite");
  transaction.objectStore(RUNS).delete(runId);
  const checkpoints = transaction.objectStore(STORE);
  for (const key of keys) {
    if (String(key).startsWith(`${runId}|`)) checkpoints.delete(key);
  }
  await transactionDone(transaction);
  writeDatabase.close();
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("sales-checkpoints")) {
        request.result.createObjectStore("sales-checkpoints", { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains("royalty-checkpoints")) {
        request.result.createObjectStore("royalty-checkpoints", { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains(RUNS)) {
        request.result.createObjectStore(RUNS, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T = IDBValidKey>(request: IDBRequest<T>) {
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
