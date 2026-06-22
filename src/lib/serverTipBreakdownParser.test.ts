import { describe, expect, it } from "vitest";

import { parseTipBreakdownHtmlOnServer } from "./serverTipBreakdownParser";

describe("parseTipBreakdownHtmlOnServer", () => {
  it("converts a Flexepos tip breakdown report table into the tip payload", () => {
    const result = parseTipBreakdownHtmlOnServer(`
      <span class="header-text">2006</span>
      <span class="header-text">Date Range: 06/01/2026 - 06/14/2026</span>
      <table>
        <thead>
          <tr>
            <th>In Store Date</th>
            <th>In Store Dine In</th>
            <th>In Store Take Out</th>
            <th>In Store Take Out Catering</th>
            <th>In Store Delivery</th>
            <th>In Store Delivery Catering</th>
            <th>Online Take Out</th>
            <th>Online Take Out Catering</th>
            <th>Online Delivery</th>
            <th>Online Delivery Catering</th>
            <th>Pay-Ins</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td></td>
            <td>2,259.07</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>261.00</td>
            <td>2,520.07</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(result).toEqual({
      sections: [
        {
          store_number: "2006",
          store_label: "2006",
          date_range: "06/01/2026 - 06/14/2026",
          payload: [
            {
              store_number: "2006",
              total_payins: 261,
              total_tips: 2520.07,
            },
          ],
        },
      ],
      payload: [
        {
          store_number: "2006",
          total_payins: 261,
          total_tips: 2520.07,
        },
      ],
      warnings: [],
    });
  });
});
