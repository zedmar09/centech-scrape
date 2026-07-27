import { NextRequest } from "next/server";

import { POST as scrapeRoyalties } from "@/app/api/royalties-scrape/route";
import {
  authorizeInternalScraperRequest,
  parseInternalRoyaltyRequest,
  readLimitedJsonRequest,
  royaltyUpstreamJobs,
  transformNdjsonResponse,
  transformRoyaltyEvent,
} from "@/lib/internalScraperApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const unauthorized = authorizeInternalScraperRequest(request);
  if (unauthorized) return unauthorized;

  const body = await readLimitedJsonRequest(request);
  if (!body.ok) return Response.json({ error: body.error }, { status: body.status });

  const parsed = parseInternalRoyaltyRequest(body.value);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 422 });

  const upstreamRequest = new NextRequest(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobs: royaltyUpstreamJobs(parsed.value) }),
  });
  const upstream = await scrapeRoyalties(upstreamRequest);
  return transformNdjsonResponse(
    upstream,
    (event) => transformRoyaltyEvent(event, parsed.value),
  );
}
