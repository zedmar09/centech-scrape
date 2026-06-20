import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { combinePayrollParseResults, extractPayrollPayload } from "./payrollParser";

function parseDocument(html: string): Document {
  return new JSDOM(html).window.document;
}

describe("extractPayrollPayload", () => {
  it("extracts payroll payload rows from whatever store section is uploaded", () => {
    const document = parseDocument(`
      <html>
        <body>
          <section>
            <span class="header-text">Store 3012 payroll</span>
            <span class="header-text">Date Range: 07/01/2026 - 07/14/2026</span>
            <table id="payroll">
              <thead>
                <tr>
                  <th>Employee Name</th>
                  <th>Employee Number</th>
                  <th>Regular Hours</th>
                  <th>Overtime Hours</th>
                  <th>Pay Rate</th>
                  <th>Wages</th>
                  <th>Incomplete</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <a href="/FlexeposWeb/tools/payroll_detail.seam?id=12345&amp;storeNumber=3012">
                      Avery Lee
                    </a>
                  </td>
                  <td>818100</td>
                  <td>40.50</td>
                  <td></td>
                  <td>15.00</td>
                  <td>607.50</td>
                  <td></td>
                </tr>
                <tr>
                  <td>
                    <a href="/FlexeposWeb/tools/payroll_detail.seam?id=67890&amp;storeNumber=3012">
                      Jordan Ray
                    </a>
                  </td>
                  <td></td>
                  <td>8.00</td>
                  <td>1.25</td>
                  <td>17.00</td>
                  <td>157.25</td>
                  <td></td>
                </tr>
                <tr>
                  <td>Total</td>
                  <td></td>
                  <td>48.50</td>
                  <td>1.25</td>
                  <td></td>
                  <td>764.75</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </section>
        </body>
      </html>
    `);

    const result = extractPayrollPayload(document);

    expect(result.sections).toEqual([
      {
        store_number: 3012,
        store_label: "Store 3012 payroll",
        date_range: "07/01/2026 - 07/14/2026",
        payload: [
          {
            employee_id: 12345,
            employee_number: 818100,
            store_number: 3012,
            regular_hours: 40.5,
            overtime_hours: null,
          },
          {
            employee_id: 67890,
            employee_number: null,
            store_number: 3012,
            regular_hours: 8,
            overtime_hours: 1.25,
          },
        ],
      },
    ]);
    expect(result.payload).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it("finds multiple payroll sections and skips non-payroll tables", () => {
    const document = parseDocument(`
      <html>
        <body>
          <table>
            <thead><tr><th>Employee Name</th><th>Pay Rate</th></tr></thead>
          </table>

          <span class="header-text">Store 2006 payroll</span>
          <table id="payroll-a">
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
                <td><a href="/detail?id=111&amp;storeNumber=2006">Casey</a></td>
                <td>1001</td>
                <td>0.00</td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <span class="header-text">Store 9144 payroll</span>
          <table id="payroll-b">
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
                <td><a href="/detail?id=222&amp;storeNumber=9144">Morgan</a></td>
                <td>1002</td>
                <td>12.25</td>
                <td>0.50</td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `);

    const result = extractPayrollPayload(document);

    expect(result.sections).toHaveLength(2);
    expect(result.payload).toEqual([
      {
        employee_id: 111,
        employee_number: 1001,
        store_number: 2006,
        regular_hours: 0,
        overtime_hours: null,
      },
      {
        employee_id: 222,
        employee_number: 1002,
        store_number: 9144,
        regular_hours: 12.25,
        overtime_hours: 0.5,
      },
    ]);
  });

  it("ignores header-compatible tables that do not contain employee payroll data", () => {
    const document = parseDocument(`
      <html>
        <body>
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
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <span class="header-text">Store 1111 payroll</span>
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
                <td><a href="/detail?id=333&amp;storeNumber=1111">Taylor</a></td>
                <td>1003</td>
                <td>10.00</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </body>
      </html>
    `);

    const result = extractPayrollPayload(document);

    expect(result.sections).toHaveLength(1);
    expect(result.payload).toEqual([
      {
        employee_id: 333,
        employee_number: 1003,
        store_number: 1111,
        regular_hours: 10,
        overtime_hours: null,
      },
    ]);
  });
});

describe("combinePayrollParseResults", () => {
  it("combines payload rows, sections, and warnings from multiple uploaded files", () => {
    const first = extractPayrollPayload(
      parseDocument(`
        <span class="header-text">Store 1001 payroll</span>
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
              <td><a href="/detail?id=10&amp;storeNumber=1001">One</a></td>
              <td>2001</td>
              <td>12.00</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      `),
    );
    const second = extractPayrollPayload(
      parseDocument(`
        <span class="header-text">Store 1002 payroll</span>
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
              <td><a href="/detail?id=20&amp;storeNumber=1002">Two</a></td>
              <td>2002</td>
              <td>8.50</td>
              <td>1.00</td>
            </tr>
          </tbody>
        </table>
      `),
    );

    const combined = combinePayrollParseResults([first, second]);

    expect(combined.sections.map((section) => section.store_number)).toEqual([
      1001,
      1002,
    ]);
    expect(combined.payload).toEqual([
      {
        employee_id: 10,
        employee_number: 2001,
        store_number: 1001,
        regular_hours: 12,
        overtime_hours: null,
      },
      {
        employee_id: 20,
        employee_number: 2002,
        store_number: 1002,
        regular_hours: 8.5,
        overtime_hours: 1,
      },
    ]);
    expect(combined.warnings).toEqual([]);
  });
});
