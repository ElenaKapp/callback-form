import { describe, expect, it } from "vitest";
import worker from "../worker/index";

const endpoint = "https://api.example.test/api/callback-requests";
const allowedOrigin = "https://frontend.example.test";

function request(body: unknown, headers: Readonly<Record<string, string>> = {}): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: allowedOrigin, ...headers },
    body: JSON.stringify(body),
  });
}

function newCustomerRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    existingCustomer: false,
    firstName: "Mara",
    lastName: "Beispiel",
    postalCode: "50667",
    city: "Köln",
    occupation: "Ingenieurin",
    employer: "Beispiel GmbH",
    email: "Mara@beispiel.de",
    phone: "+49 221 1234567",
    products: ["home", "car"],
    callbackTime: "morning",
    privacyConsent: true,
    ...overrides,
  };
}

function customerNumberRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    existingCustomer: true,
    customerNumber: "12345678",
    phone: "+49 221 1234567",
    products: ["car"],
    callbackTime: "afternoon",
    privacyConsent: true,
    ...overrides,
  };
}

function createEnv(put: (key: string, document: string) => Promise<void> = async () => {}): {
  readonly CALLBACK_REQUESTS: {
    put(key: string, document: string, options: { httpMetadata: { contentType: string } }): Promise<void>;
  };
  readonly FRONTEND_ORIGIN: string;
} {
  return {
    FRONTEND_ORIGIN: allowedOrigin,
    CALLBACK_REQUESTS: {
      put: async (key, document, options) => {
        expect(options.httpMetadata.contentType).toBe("text/html; charset=utf-8");
        await put(key, document);
      },
    },
  };
}

describe("callback request worker", () => {
  it("rejects methods other than POST", async () => {
    const response = await worker.fetch(
      new Request(endpoint, { headers: { Origin: allowedOrigin } }),
      createEnv(),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
  });

  it("allows a preflight only from the configured frontend origin", async () => {
    const response = await worker.fetch(
      new Request(endpoint, {
        method: "OPTIONS",
        headers: {
          Origin: allowedOrigin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
      createEnv(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("rejects a preflight requesting an unapproved header", async () => {
    const response = await worker.fetch(
      new Request(endpoint, {
        method: "OPTIONS",
        headers: {
          Origin: allowedOrigin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type, x-custom",
        },
      }),
      createEnv(),
    );

    expect(response.status).toBe(403);
  });

  it("requires JSON content", async () => {
    const response = await worker.fetch(
      request(newCustomerRequest(), { "Content-Type": "text/plain" }),
      createEnv(),
    );

    expect(response.status).toBe(415);
  });

  it("rejects browser requests from a different origin", async () => {
    const response = await worker.fetch(
      request(newCustomerRequest(), { Origin: "https://another.test" }),
      createEnv(),
    );

    expect(response.status).toBe(403);
  });

  it("limits the request body size", async () => {
    const response = await worker.fetch(
      request({ value: "x".repeat(17_000) }),
      createEnv(),
    );

    expect(response.status).toBe(413);
  });

  it("escapes customer input and writes a generated object key", async () => {
    let storedKey = "";
    let storedDocument = "";
    const response = await worker.fetch(
      request(newCustomerRequest({ firstName: `<script>alert("x")</script>` })),
      createEnv(async (key, document) => {
        storedKey = key;
        storedDocument = document;
      }),
    );
    const result: unknown = await response.json();

    expect(response.status).toBe(202);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
    expect(result).toEqual({ status: "accepted" });
    expect(storedKey).toMatch(/^callback-requests\/[0-9a-f-]{36}\.html$/u);
    expect(storedDocument).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(storedDocument).not.toContain("<script>alert");
    expect(storedDocument).toContain("mara@beispiel.de");
  });

  it("does not persist personal fields when a customer number is provided", async () => {
    let storedDocument = "";
    const response = await worker.fetch(
      request(customerNumberRequest({
        firstName: "Max",
        lastName: "Mustermann",
        email: "secret@example.test",
      })),
      createEnv(async (_key, document) => {
        storedDocument = document;
      }),
    );

    expect(response.status).toBe(202);
    expect(storedDocument).toContain("12345678");
    expect(storedDocument).not.toContain("Max");
    expect(storedDocument).not.toContain("Mustermann");
    expect(storedDocument).not.toContain("secret@example.test");
  });

  it("stores personal details when no customer number is available", async () => {
    let storedDocument = "";
    const response = await worker.fetch(
      request(newCustomerRequest()),
      createEnv(async (_key, document) => {
        storedDocument = document;
      }),
    );

    expect(response.status).toBe(202);
    expect(storedDocument).toContain("<dt>Vorname</dt><dd>Mara</dd>");
    expect(storedDocument).toContain("<dt>Nachname</dt><dd>Beispiel</dd>");
    expect(storedDocument).toContain("<dt>PLZ</dt><dd>50667</dd>");
    expect(storedDocument).toContain("<dt>Wohnort</dt><dd>Köln</dd>");
    expect(storedDocument).toContain("<dt>Beruf</dt><dd>Ingenieurin</dd>");
    expect(storedDocument).toContain("<dt>Arbeitgeber</dt><dd>Beispiel GmbH</dd>");
    expect(storedDocument).toContain("mara@beispiel.de");
    expect(storedDocument).toContain("Haus &amp; Wohnen");
    expect(storedDocument).toContain("Kfz-Versicherung");
  });

  it("rejects requests without a customer number or the required personal details", async () => {
    const response = await worker.fetch(
      request({
        existingCustomer: false,
        phone: "+49 221 1234567",
        products: ["home"],
        callbackTime: "morning",
        privacyConsent: true,
      }),
      createEnv(),
    );

    expect(response.status).toBe(400);
  });

  it("rejects an invalid postal code", async () => {
    const response = await worker.fetch(
      request(newCustomerRequest({ postalCode: "5066" })),
      createEnv(),
    );

    expect(response.status).toBe(400);
  });

  it("rejects an invalid product and an unapproved extra field", async () => {
    const invalidProduct = await worker.fetch(
      request(newCustomerRequest({ products: ["unlisted-product"] })),
      createEnv(),
    );
    const noProduct = await worker.fetch(
      request(newCustomerRequest({ products: [] })),
      createEnv(),
    );
    const duplicateProduct = await worker.fetch(
      request(newCustomerRequest({ products: ["car", "car"] })),
      createEnv(),
    );
    const extraField = await worker.fetch(
      request(newCustomerRequest({ admin: true })),
      createEnv(),
    );

    expect(invalidProduct.status).toBe(400);
    expect(noProduct.status).toBe(400);
    expect(duplicateProduct.status).toBe(400);
    expect(extraField.status).toBe(400);
  });

  it("returns a service error when object storage fails", async () => {
    const response = await worker.fetch(
      request(newCustomerRequest()),
      createEnv(async () => {
        throw new Error("storage unavailable");
      }),
    );

    expect(response.status).toBe(503);
  });
});
