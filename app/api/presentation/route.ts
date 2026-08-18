// PPTX in, PDF out.
//
// This endpoint exists because PowerPoint has no browser renderer. Everything else in
// this app runs client-side; a presentation cannot, so it is converted here and the
// bytes are discarded as soon as the response is written. Nothing is stored, logged or
// queued — the temporary directory LibreOffice works in is removed before we return.
//
// Access is already gated: middleware.ts requires a valid session for every route
// except the login screen and the endpoint that grants access.

import { OfficeError, presentationToPdf, sniffPresentation } from "@/src/lib/office-server.ts";
import { MAX_BYTES, pptxEnabled } from "@/src/lib/pricing.ts";

export const runtime = "nodejs";
// LibreOffice is given 60s; the platform must not cut the request off before it.
export const maxDuration = 60;

const fail = (code: string, message: string, status: number) =>
  Response.json({ code, message }, { status });

export async function POST(request: Request): Promise<Response> {
  // The interface hides this route when it is switched off; that hiding is a courtesy,
  // and this is the gate. A deployment without LibreOffice must not accept uploads it
  // has no way to answer.
  if (!pptxEnabled()) {
    return fail("DISABLED", "Presentation conversion is not available on this deployment.", 503);
  }

  // Reject on the declared length before reading the body, so an oversized upload is
  // refused rather than buffered in full and then refused.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return fail("TOO_LARGE", `The limit is ${MAX_BYTES / 1024 / 1024} MB.`, 413);
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length) return fail("EMPTY", "No file was sent.", 400);
  if (body.length > MAX_BYTES) {
    return fail("TOO_LARGE", `The limit is ${MAX_BYTES / 1024 / 1024} MB.`, 413);
  }

  const kind = sniffPresentation(body);
  if (!kind) return fail("NOT_A_PRESENTATION", "This file is not a PowerPoint presentation.", 415);

  try {
    const pdf = await presentationToPdf(body, kind);
    // BodyInit's view case is pinned to ArrayBuffer, which Uint8Array<ArrayBufferLike>
    // does not satisfy. presentationToPdf builds its array by copy, so this buffer is a
    // plain ArrayBuffer holding exactly these bytes and nothing else.
    return new Response(pdf.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        // Nothing here is cacheable: it is one user's document, held for one response.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof OfficeError) {
      const status = err.code === "NOT_INSTALLED" ? 503 : err.code === "TIMEOUT" ? 504 : 422;
      // The underlying message can name server paths, so only the code crosses the wire.
      return fail(err.code, MESSAGES[err.code] ?? MESSAGES.FAILED!, status);
    }
    return fail("FAILED", MESSAGES.FAILED!, 500);
  }
}

const MESSAGES: Record<string, string> = {
  NOT_INSTALLED: "Presentation conversion is unavailable on this server.",
  TIMEOUT: "This presentation took too long to convert. Try a smaller deck.",
  EMPTY_OUTPUT: "This presentation could not be converted — it may be corrupt or password protected.",
  FAILED: "This presentation could not be converted.",
};
