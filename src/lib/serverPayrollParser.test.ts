import { describe, expect, it } from "vitest";

import { parsePayrollHtmlOnServer } from "./serverPayrollParser";

describe("parsePayrollHtmlOnServer", () => {
  it("parses payroll HTML in a Node route handler without DOMParser", () => {
    const result = parsePayrollHtmlOnServer(`
      <span class="header-text">Store 2006 payroll</span>
      <table>
        <thead>
          <tr>
            <th>Employee Name</th>
            <th>Employee Number</th>
            <th>Regular Hours</th>
            <th>Overtime Hours</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><a href="/detail?id=9001&amp;storeNumber=2006">Sam</a></td>
            <td>7319</td>
            <td>38.25</td>
            <td>2.75</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(result.payload).toEqual([
      {
        employee_id: 9001,
        employee_number: 7319,
        store_number: 2006,
        regular_hours: 38.25,
        overtime_hours: 2.75,
      },
    ]);
  });
});
