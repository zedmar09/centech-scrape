import { describe, expect, it } from "vitest";

import {
  employeeKey,
  expectedPayrollEmployees,
  reconcileTimeclocks,
  runEmployeeTimeclockJobs,
  selectEmployeesForTimeclockRetry,
  timeclockCheckpointKey,
  validateTimeclockResult,
  type EmployeeTimeclockCheckpoint,
  type PayrollEmployeeRef,
} from "./payrollTimeclocks";

const expected: PayrollEmployeeRef[] = [
  { employee_id: 10, employee_number: 1001, store_number: 2006 },
  { employee_id: 20, employee_number: 1002, store_number: 2006 },
  { employee_id: 30, employee_number: 1003, store_number: 2006 },
];

function checkpoint(index: number, status: EmployeeTimeclockCheckpoint["status"], updated = "2026-08-06T01:00:00.000Z") {
  const employee = expected[index];
  return {
    ...employee,
    attempts: 1,
    error: status === "failed" ? "navigation failed" : undefined,
    key: `run|${employeeKey(employee)}`,
    pay_period_start: "07/27/2026",
    pay_period_end: "08/02/2026",
    rows: [],
    status,
    updated_at: updated,
  } satisfies EmployeeTimeclockCheckpoint;
}

describe("payroll timeclock completion", () => {
  it("prefers employee ID and falls back to employee number", () => {
    expect(employeeKey(expected[0])).toBe("id:10");
    expect(employeeKey({ employee_id: null, employee_number: 1001 })).toBe("number:1001");
    expect(employeeKey({ employee_id: null, employee_number: null })).toBeNull();
  });

  it("deduplicates expected payroll employees", () => {
    expect(expectedPayrollEmployees([
      { employee_id: 10, employee_number: 1001, store_number: 2006, regular_hours: 8, overtime_hours: 0 },
      { employee_id: 10, employee_number: 1001, store_number: 2006, regular_hours: 4, overtime_hours: 0 },
    ])).toEqual([expected[0]]);
  });

  it("retries only failed and missing employees", () => {
    const result = reconcileTimeclocks(expected, [checkpoint(0, "completed"), checkpoint(1, "failed")]);
    expect(result.completed).toEqual(["id:10"]);
    expect(result.retry).toEqual(["id:30", "id:20"]);
    expect(result.complete).toBe(false);
  });

  it("does not treat unavailable employees as completed", () => {
    const result = reconcileTimeclocks(expected, [
      checkpoint(0, "completed"), checkpoint(1, "completed"), checkpoint(2, "unavailable"),
    ]);
    expect(result.unavailable).toEqual(["id:30"]);
    expect(result.complete).toBe(false);
  });

  it("uses the latest checkpoint for duplicate attempts", () => {
    const result = reconcileTimeclocks(expected.slice(0, 1), [
      checkpoint(0, "failed"), checkpoint(0, "completed", "2026-08-06T02:00:00.000Z"),
    ]);
    expect(result.complete).toBe(true);
  });

  it("creates a key scoped to run, store, dates, and employee", () => {
    expect(timeclockCheckpointKey("run-1", expected[0], "07/27/2026", "08/02/2026"))
      .toBe("run-1|2006|07/27/2026|08/02/2026|id:10");
  });

  it("resumes a partial run without selecting completed employees again", () => {
    const tenEmployees = Array.from({ length: 10 }, (_, index) => ({
      employee_id: index + 1,
      employee_number: 1000 + index,
      store_number: 2006,
    }));
    const records = tenEmployees.slice(0, 7).map((employee, index) => ({
      ...checkpoint(0, "completed"),
      ...employee,
      key: `run|id:${employee.employee_id}`,
      status: index === 6 ? "failed" as const : "completed" as const,
    }));

    expect(selectEmployeesForTimeclockRetry(tenEmployees, records).map(employeeKey))
      .toEqual(["id:7", "id:8", "id:9", "id:10"]);
  });
});

describe("timeclock page validation", () => {
  it("accepts an empty table as a completed zero-row result", () => {
    expect(validateTimeclockResult({
      actualPayPeriod: "07/27/2026 - 08/02/2026",
      expectedPayPeriodStart: "07/27/2026",
      expectedPayPeriodEnd: "08/02/2026",
      tableFound: true,
      rows: [],
    })).toEqual([]);
  });

  it("rejects a wrong pay period or missing table", () => {
    expect(() => validateTimeclockResult({
      actualPayPeriod: "07/20/2026 - 07/26/2026",
      expectedPayPeriodStart: "07/27/2026", expectedPayPeriodEnd: "08/02/2026", tableFound: true, rows: [],
    })).toThrow("pay period mismatch");
    expect(() => validateTimeclockResult({
      actualPayPeriod: "07/27/2026 - 08/02/2026",
      expectedPayPeriodStart: "07/27/2026", expectedPayPeriodEnd: "08/02/2026", tableFound: false, rows: [],
    })).toThrow("table was not found");
  });
});

describe("employee timeclock worker", () => {
  it("checkpoints every employee, continues after failure, and resumes only unresolved work", async () => {
    const saved: EmployeeTimeclockCheckpoint[] = [];
    const attempted: number[] = [];
    const firstRun = await runEmployeeTimeclockJobs({
      runId: "run-1",
      employees: expected,
      payPeriodStart: "07/27/2026",
      payPeriodEnd: "08/02/2026",
      scrapeEmployee: async (employee) => {
        attempted.push(employee.employee_id!);
        if (employee.employee_id === 20) throw new Error("page closed");
        return [];
      },
      saveCheckpoint: async (record) => { saved.push(record); },
      now: () => new Date("2026-08-06T01:00:00.000Z"),
    });
    expect(firstRun.map((record) => record.status)).toEqual(["completed", "failed", "completed"]);
    expect(saved).toHaveLength(3);

    attempted.length = 0;
    await runEmployeeTimeclockJobs({
      runId: "run-1",
      employees: expected,
      existingCheckpoints: saved,
      payPeriodStart: "07/27/2026",
      payPeriodEnd: "08/02/2026",
      scrapeEmployee: async (employee) => { attempted.push(employee.employee_id!); return []; },
      saveCheckpoint: async () => undefined,
      now: () => new Date("2026-08-06T02:00:00.000Z"),
    });
    expect(attempted).toEqual([20]);
  });
});
