import type { PayrollPayload } from "./payrollParser";

export type TimeclockStatus = "completed" | "failed" | "unavailable";

export type PayrollEmployeeRef = {
  employee_id: number | null;
  employee_number: number | null;
  store_number: number;
};

export type TimeclockRow = {
  date: string;
  start_time: string;
  adjusted_start_time: string;
  end_time: string;
  adjusted_end_time: string;
  worked_time: string;
};

export type EmployeeTimeclockCheckpoint = PayrollEmployeeRef & {
  key: string;
  pay_period_start: string;
  pay_period_end: string;
  status: TimeclockStatus;
  rows: TimeclockRow[];
  attempts: number;
  updated_at: string;
  error?: string;
};

export type TimeclockCompletion = {
  complete: boolean;
  completed: string[];
  failed: string[];
  unavailable: string[];
  missing: string[];
  retry: string[];
};

export type RunEmployeeTimeclockJobsInput = {
  runId: string;
  employees: PayrollEmployeeRef[];
  existingCheckpoints?: EmployeeTimeclockCheckpoint[];
  payPeriodStart: string;
  payPeriodEnd: string;
  scrapeEmployee: (employee: PayrollEmployeeRef) => Promise<TimeclockRow[]>;
  saveCheckpoint: (checkpoint: EmployeeTimeclockCheckpoint) => Promise<void>;
  now?: () => Date;
};

export function employeeKey(employee: Pick<PayrollEmployeeRef, "employee_id" | "employee_number">) {
  if (employee.employee_id !== null) return `id:${employee.employee_id}`;
  if (employee.employee_number !== null) return `number:${employee.employee_number}`;
  return null;
}

export function timeclockCheckpointKey(
  runId: string,
  employee: PayrollEmployeeRef,
  payPeriodStart: string,
  payPeriodEnd: string,
) {
  const identity = employeeKey(employee);
  if (!identity) throw new Error("A payroll employee needs an ID or employee number for timeclock checkpointing.");
  return [runId, employee.store_number, payPeriodStart, payPeriodEnd, identity].join("|");
}

export function expectedPayrollEmployees(payload: PayrollPayload[]): PayrollEmployeeRef[] {
  const employees = new Map<string, PayrollEmployeeRef>();
  for (const row of payload) {
    if (row.store_number === null) continue;
    const employee = {
      employee_id: row.employee_id,
      employee_number: row.employee_number,
      store_number: row.store_number,
    };
    const key = employeeKey(employee);
    if (key) employees.set(`${employee.store_number}|${key}`, employee);
  }
  return [...employees.values()];
}

export function reconcileTimeclocks(
  expected: PayrollEmployeeRef[],
  checkpoints: EmployeeTimeclockCheckpoint[],
): TimeclockCompletion {
  const expectedKeys = new Set(expected.map(employeeKey).filter((key): key is string => key !== null));
  const latest = new Map<string, EmployeeTimeclockCheckpoint>();

  for (const checkpoint of checkpoints) {
    const key = employeeKey(checkpoint);
    if (!key || !expectedKeys.has(key)) continue;
    const existing = latest.get(key);
    if (!existing || existing.updated_at <= checkpoint.updated_at) latest.set(key, checkpoint);
  }

  const completed: string[] = [];
  const failed: string[] = [];
  const unavailable: string[] = [];
  const missing: string[] = [];
  for (const key of expectedKeys) {
    const checkpoint = latest.get(key);
    if (!checkpoint) missing.push(key);
    else if (checkpoint.status === "completed") completed.push(key);
    else if (checkpoint.status === "failed") failed.push(key);
    else unavailable.push(key);
  }

  const retry = [...missing, ...failed];
  return {
    complete: expectedKeys.size > 0 && completed.length === expectedKeys.size,
    completed,
    failed,
    unavailable,
    missing,
    retry,
  };
}

export function selectEmployeesForTimeclockRetry(
  expected: PayrollEmployeeRef[],
  checkpoints: EmployeeTimeclockCheckpoint[],
) {
  const retryKeys = new Set(reconcileTimeclocks(expected, checkpoints).retry);
  return expected.filter((employee) => {
    const key = employeeKey(employee);
    return key !== null && retryKeys.has(key);
  });
}

export async function runEmployeeTimeclockJobs({
  runId,
  employees,
  existingCheckpoints = [],
  payPeriodStart,
  payPeriodEnd,
  scrapeEmployee,
  saveCheckpoint,
  now = () => new Date(),
}: RunEmployeeTimeclockJobsInput) {
  const selected = selectEmployeesForTimeclockRetry(employees, existingCheckpoints);
  const saved: EmployeeTimeclockCheckpoint[] = [];
  const previous = new Map(
    existingCheckpoints.map((checkpoint) => [employeeKey(checkpoint), checkpoint]),
  );

  for (const employee of selected) {
    const identity = employeeKey(employee);
    if (!identity) continue;
    let checkpoint: EmployeeTimeclockCheckpoint;
    try {
      const rows = await scrapeEmployee(employee);
      checkpoint = {
        ...employee,
        attempts: (previous.get(identity)?.attempts ?? 0) + 1,
        key: timeclockCheckpointKey(runId, employee, payPeriodStart, payPeriodEnd),
        pay_period_start: payPeriodStart,
        pay_period_end: payPeriodEnd,
        rows,
        status: "completed",
        updated_at: now().toISOString(),
      };
    } catch (caught) {
      checkpoint = {
        ...employee,
        attempts: (previous.get(identity)?.attempts ?? 0) + 1,
        error: caught instanceof Error ? caught.message : "Timeclock scrape failed.",
        key: timeclockCheckpointKey(runId, employee, payPeriodStart, payPeriodEnd),
        pay_period_start: payPeriodStart,
        pay_period_end: payPeriodEnd,
        rows: [],
        status: "failed",
        updated_at: now().toISOString(),
      };
    }
    await saveCheckpoint(checkpoint);
    saved.push(checkpoint);
  }
  return saved;
}

export function validateTimeclockResult(input: {
  actualPayPeriod: string | null;
  expectedPayPeriodStart: string;
  expectedPayPeriodEnd: string;
  tableFound: boolean;
  rows: TimeclockRow[];
}) {
  const expected = `${input.expectedPayPeriodStart} - ${input.expectedPayPeriodEnd}`;
  if (input.actualPayPeriod !== expected) {
    throw new Error(`Employee pay period mismatch; expected ${expected}.`);
  }
  if (!input.tableFound) throw new Error("Adjust Time table was not found.");
  return input.rows;
}
