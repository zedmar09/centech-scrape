import type { SalesComparisonRow, SalesJob, SalesOrganization } from "./salesReport";

export type SalesCheckpoint = {
  key: string;
  run_id: string;
  organization: SalesOrganization;
  business_date: string;
  store_number: string;
  status: "completed" | "failed";
  attempts: number;
  rows: SalesComparisonRow[];
  error?: string;
};

const DATABASE = "centech-financial";
const STORE = "sales-checkpoints";

export async function loadSalesCheckpoints(
  runId: string,
) {
  const database = await openDatabase();
  const records = await requestToPromise<SalesCheckpoint[]>(
    database.transaction(STORE, "readonly").objectStore(STORE).getAll(),
  );
  database.close();
  return records.filter((record) => record.run_id === runId);
}

export async function saveSalesCheckpoint(checkpoint: SalesCheckpoint) {
  const database = await openDatabase();
  await requestToPromise(database.transaction(STORE, "readwrite").objectStore(STORE).put(checkpoint));
  database.close();
}

export function checkpointFromFailure(job: SalesJob, error: string, runId: string): SalesCheckpoint {
  return {
    attempts: job.attempts,
    business_date: job.business_date,
    error,
    key: `${runId}|${job.organization}|${job.business_date}|${job.store_number}`,
    run_id: runId,
    organization: job.organization,
    rows: [],
    status: "failed",
    store_number: job.store_number,
  };
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains("royalty-checkpoints")) {
        request.result.createObjectStore("royalty-checkpoints", { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains("financial-runs")) {
        request.result.createObjectStore("financial-runs", { keyPath: "id" });
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
