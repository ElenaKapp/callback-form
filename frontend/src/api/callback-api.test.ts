import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCallbackPayload, sendCallbackRequest } from "./callback-api";
import type { CallbackRequest } from "../../../shared/callback-request";
import { validateCallbackRequest } from "../../../shared/callback-validation";

const request: CallbackRequest = {
  existingCustomer: true,
  customerNumber: "12345678",
  phone: "+49 221 1234567",
  products: ["car"],
  callbackTime: "morning",
  privacyConsent: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sendCallbackRequest", () => {
  function prospectiveCustomerFormData(): FormData {
    const formData = new FormData();
    formData.set("firstName", "Mara");
    formData.set("lastName", "Beispiel");
    formData.set("postalCode", "50667");
    formData.set("city", "Köln");
    formData.set("occupation", "Ingenieurin");
    formData.set("employer", "Beispiel GmbH");
    formData.set("email", "mara@example.test");
    formData.set("phone", "+49 221 1234567");
    formData.append("products", "home");
    formData.append("products", "car");
    formData.set("callbackTime", "morning");
    formData.set("privacyConsent", "on");
    return formData;
  }

  it("includes personal details when no customer number is available", () => {
    expect(buildCallbackPayload(false, prospectiveCustomerFormData())).toEqual({
      existingCustomer: false,
      firstName: "Mara",
      lastName: "Beispiel",
      postalCode: "50667",
      city: "Köln",
      occupation: "Ingenieurin",
      employer: "Beispiel GmbH",
      email: "mara@example.test",
      phone: "+49 221 1234567",
      products: ["home", "car"],
      callbackTime: "morning",
      privacyConsent: true,
    });
  });

  it("omits personal details when a customer number is available", () => {
    const formData = new FormData();
    formData.set("customerNumber", "12345678");
    formData.set("phone", "+49 221 1234567");
    formData.append("products", "car");
    formData.set("callbackTime", "morning");
    formData.set("privacyConsent", "on");
    formData.set("firstName", "Must not be sent");

    expect(buildCallbackPayload(true, formData)).toEqual({
      existingCustomer: true,
      customerNumber: "12345678",
      phone: "+49 221 1234567",
      products: ["car"],
      callbackTime: "morning",
      privacyConsent: true,
    });
  });

  it("returns successfully for an accepted request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));

    await expect(sendCallbackRequest(request)).resolves.toBeUndefined();
  });

  it("serializes the personal details into the request sent to the API", async () => {
    let sentBody: BodyInit | null | undefined;
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => {
      sentBody = options?.body;
      return Promise.resolve(new Response(null, { status: 202 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const validation = validateCallbackRequest(
      buildCallbackPayload(false, prospectiveCustomerFormData()),
    );
    if (!validation.ok) {
      throw new Error("Expected valid prospective-customer details.");
    }

    await sendCallbackRequest(validation.value);

    expect(typeof sentBody).toBe("string");
    if (typeof sentBody !== "string") {
      throw new Error("Expected the request body to be JSON text.");
    }
    const sentPayload: unknown = JSON.parse(sentBody);
    expect(sentPayload).toEqual({
      existingCustomer: false,
      firstName: "Mara",
      lastName: "Beispiel",
      postalCode: "50667",
      city: "Köln",
      occupation: "Ingenieurin",
      employer: "Beispiel GmbH",
      email: "mara@example.test",
      phone: "+49 221 1234567",
      products: ["home", "car"],
      callbackTime: "morning",
      privacyConsent: true,
    });
  });

  it("reports a missing API route instead of leaving the form in a loading state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(sendCallbackRequest(request)).rejects.toThrow(
      "Der Rückrufservice ist gerade nicht erreichbar.",
    );
  });

  it("aborts a request that exceeds the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      ),
    );

    const pendingRequest = sendCallbackRequest(request);
    const rejection = expect(pendingRequest).rejects.toThrow("Die Übermittlung dauert zu lange.");
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
  });
});
