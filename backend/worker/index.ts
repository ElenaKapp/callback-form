import type { CallbackRequest } from "../../shared/callback-request";
import { validateCallbackRequest } from "../../shared/callback-validation";

const MAX_REQUEST_BYTES = 16_384;
const API_PATH = "/api/callback-requests";

interface CallbackBucket {
  put(
    key: string,
    value: string,
    options: { httpMetadata: { contentType: string } },
  ): Promise<unknown>;
}

interface Env {
  readonly CALLBACK_REQUESTS: CallbackBucket;
  readonly FRONTEND_ORIGIN: string;
}

type ReadBodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly tooLarge: boolean };

async function readJsonBody(request: Request): Promise<ReadBodyResult> {
  if (!request.body) {
    return { ok: false, tooLarge: false };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function productLabel(product: string): string {
  const labels: Readonly<Record<string, string>> = {
    car: "Kfz-Versicherung",
    home: "Haus & Wohnen",
    liability: "Haftpflicht",
    legal: "Rechtsschutz",
    health: "Gesundheit & Pflege",
    other: "Ein anderes Thema",
  };
  return labels[product] ?? "Ein anderes Thema";
}

function callbackTimeLabel(time: string): string {
  return time === "morning" ? "Vormittags (9–12 Uhr)" : "Nachmittags (12–17 Uhr)";
}

function renderDocument(requestId: string, data: CallbackRequest): string {
  const contactDetails = data.existingCustomer
    ? `<dt>Kundennummer</dt><dd>${escapeHtml(data.customerNumber)}</dd>`
    : `<dt>Vorname</dt><dd>${escapeHtml(data.firstName)}</dd>
<dt>Nachname</dt><dd>${escapeHtml(data.lastName)}</dd>
<dt>PLZ</dt><dd>${escapeHtml(data.postalCode)}</dd>
<dt>Wohnort</dt><dd>${escapeHtml(data.city)}</dd>
${data.occupation ? `<dt>Beruf</dt><dd>${escapeHtml(data.occupation)}</dd>` : ""}
${data.employer ? `<dt>Arbeitgeber</dt><dd>${escapeHtml(data.employer)}</dd>` : ""}
<dt>E-Mail-Adresse</dt><dd>${escapeHtml(data.email)}</dd>`;

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>Rückrufanfrage ${escapeHtml(requestId)}</title>
</head>
<body>
<main>
<h1>Rückrufanfrage</h1>
<dl>
${contactDetails}
<dt>Telefonnummer</dt><dd>${escapeHtml(data.phone)}</dd>
<dt>Versicherungssparten</dt><dd>${escapeHtml(data.products.map(productLabel).join(", "))}</dd>
<dt>Gewünschte Rückrufzeit</dt><dd>${escapeHtml(callbackTimeLabel(data.callbackTime))}</dd>
<dt>Datenschutzhinweise akzeptiert</dt><dd>Ja</dd>
</dl>
</main>
</body>
</html>`;
}

function jsonResponse(
  status: number,
  body: Readonly<Record<string, string>>,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== API_PATH) {
      return jsonResponse(404, { error: "Nicht gefunden." });
    }
    const origin = request.headers.get("Origin");
    if (origin !== env.FRONTEND_ORIGIN) {
      return jsonResponse(403, { error: "Anfrage nicht erlaubt." });
    }
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.FRONTEND_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    };
    if (request.method === "OPTIONS") {
      const requestedMethod = request.headers.get("Access-Control-Request-Method");
      const requestedHeaders = request.headers.get("Access-Control-Request-Headers");
      if (
        requestedMethod?.toUpperCase() !== "POST" ||
        requestedHeaders?.split(",").some((header) => header.trim().toLowerCase() !== "content-type")
      ) {
        return jsonResponse(403, { error: "Anfrage nicht erlaubt." });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return jsonResponse(
        405,
        { error: "Methode nicht erlaubt." },
        { ...corsHeaders, Allow: "POST, OPTIONS" },
      );
    }
    const contentType = request.headers.get("Content-Type");
    if (contentType?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return jsonResponse(415, { error: "Bitte senden Sie die Anfrage im JSON-Format." }, corsHeaders);
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return jsonResponse(body.tooLarge ? 413 : 400, {
        error: body.tooLarge ? "Die Anfrage ist zu groß." : "Die Anfrage konnte nicht gelesen werden.",
      }, corsHeaders);
    }

    const validation = validateCallbackRequest(body.value);
    if (!validation.ok) {
      return jsonResponse(
        400,
        { error: "Bitte prüfen Sie Ihre Angaben und versuchen Sie es erneut." },
        corsHeaders,
      );
    }

    const requestId = crypto.randomUUID();
    const document = renderDocument(requestId, validation.value);
    try {
      await env.CALLBACK_REQUESTS.put(`callback-requests/${requestId}.html`, document, {
        httpMetadata: { contentType: "text/html; charset=utf-8" },
      });
    } catch {
      return jsonResponse(
        503,
        { error: "Die Anfrage konnte gerade nicht gespeichert werden." },
        corsHeaders,
      );
    }

    return jsonResponse(202, { status: "accepted" }, corsHeaders);
  },
};

export default worker;
