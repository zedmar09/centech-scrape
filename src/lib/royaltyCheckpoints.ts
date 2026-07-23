import type { RoyaltyJob, RoyaltyRow } from "./royaltyReport";
import type { SalesOrganization } from "./salesReport";

export type RoyaltyCheckpoint = {
  key: string; run_id: string; organization: SalesOrganization; start_date: string; end_date: string;
  store_number: string; status: "completed" | "failed"; attempts: number; rows: RoyaltyRow[]; error?: string;
};

const DB = "centech-financial";
const STORE = "royalty-checkpoints";

export async function loadRoyaltyCheckpoints(runId: string) {
  const db = await open();
  const rows = await request<RoyaltyCheckpoint[]>(db.transaction(STORE).objectStore(STORE).getAll());
  db.close();
  return rows.filter((row) => row.run_id === runId);
}

export async function saveRoyaltyCheckpoint(row: RoyaltyCheckpoint) {
  const db = await open();
  await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(row));
  db.close();
}

export function royaltyFailure(job: RoyaltyJob, error: string, runId: string): RoyaltyCheckpoint {
  return { attempts: job.attempts, end_date: job.end_date, error, key: `${runId}|${job.organization}|${job.start_date}|${job.end_date}|${job.store_number}`, run_id: runId, organization: job.organization, rows: [], start_date: job.start_date, status: "failed", store_number: job.store_number };
}

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "key" });
      if (!req.result.objectStoreNames.contains("sales-checkpoints")) req.result.createObjectStore("sales-checkpoints", { keyPath: "key" });
      if (!req.result.objectStoreNames.contains("financial-runs")) req.result.createObjectStore("financial-runs", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
