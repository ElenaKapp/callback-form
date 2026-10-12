import type { CallbackRequest } from "../../../shared/callback-request";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/u, "") ?? "";
const REQUEST_TIMEOUT_MS = 15_000;
const API_PATH = "/api/callback-requests";

export function buildCallbackPayload(
  existingCustomer: boolean,
  data: FormData,
): Record<string, unknown> {
  const common: Record<string, unknown> = {
    existingCustomer,
    phone: data.get("phone"),
    products: data.getAll("products"),
    callbackTime: data.get("callbackTime"),
    privacyConsent: data.get("privacyConsent") === "on",
  };

  return existingCustomer
    ? { ...common, customerNumber: data.get("customerNumber") }
    : {
        ...common,
        firstName: data.get("firstName"),
        lastName: data.get("lastName"),
        postalCode: data.get("postalCode"),
        city: data.get("city"),
        occupation: data.get("occupation"),
        employer: data.get("employer"),
        email: data.get("email"),
      };
}

export async function sendCallbackRequest(data: CallbackRequest): Promise<void> {
  if (import.meta.env.PROD && API_BASE_URL.length === 0) {
    throw new Error("Der Rückrufservice ist noch nicht konfiguriert. Bitte versuchen Sie es später erneut.");
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${API_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "omit",
      signal: controller.signal,
    });

    if (response.status === 404) {
      throw new Error("Der Rückrufservice ist gerade nicht erreichbar. Bitte versuchen Sie es später erneut.");
    }
    if (response.status >= 400 && response.status < 500) {
      throw new Error("Ihre Angaben konnten nicht übermittelt werden. Bitte prüfen Sie das Formular und versuchen Sie es erneut.");
    }
    if (!response.ok) {
      throw new Error("Der Rückrufservice ist gerade nicht verfügbar. Bitte versuchen Sie es später erneut.");
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Die Übermittlung dauert zu lange. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
