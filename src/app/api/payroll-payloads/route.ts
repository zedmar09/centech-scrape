import { NextRequest, NextResponse } from "next/server";

import { PayrollPayload } from "@/lib/payrollParser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SavePayrollPayloadRequest = {
  run_id?: unknown;
  payload?: unknown;
};

export async function POST(request: NextRequest) {
  let body: SavePayrollPayloadRequest;

  try {
    body = (await request.json()) as SavePayrollPayloadRequest;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.payload)) {
    return NextResponse.json(
      { error: "payload must be an array of payroll rows." },
      { status: 400 },
    );
  }

  const payload = body.payload as PayrollPayload[];
  const runId = typeof body.run_id === "string" ? body.run_id : null;
  const saveUrl = process.env.PAYROLL_PAYLOAD_SAVE_URL;

  if (saveUrl) {
    const response = await fetch(saveUrl, {
      method: "POST",
      headers: createSaveHeaders(),
      body: JSON.stringify({
        run_id: runId,
        payload,
      }),
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Payroll backend returned ${response.status} while saving payload.`,
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    saved: Boolean(saveUrl),
    accepted: true,
    run_id: runId,
    rows: payload.length,
  });
}

function createSaveHeaders() {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const token = process.env.PAYROLL_PAYLOAD_SAVE_TOKEN?.trim();

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
}
