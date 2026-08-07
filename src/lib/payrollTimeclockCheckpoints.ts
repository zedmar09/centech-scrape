import type { EmployeeTimeclockCheckpoint } from "./payrollTimeclocks";

const DATABASE = "centech-scrape";
const VERSION = 3;
const STORE = "payroll-timeclock-checkpoints";

export async function savePayrollTimeclockCheckpoint(checkpoint: EmployeeTimeclockCheckpoint) {
  const database = await openDatabase();
  await requestToPromise(database.transaction(STORE, "readwrite").objectStore(STORE).put(checkpoint));
  database.close();
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
