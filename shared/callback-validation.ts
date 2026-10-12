import { CALLBACK_TIMES, PRODUCTS } from "./callback-request";
import type {
  CallbackField,
  CallbackRequest,
  CallbackTime,
  Product,
  ValidationResult,
} from "./callback-request";

const KNOWN_FIELDS: ReadonlySet<string> = new Set<CallbackField>([
  "existingCustomer",
  "customerNumber",
  "firstName",
  "lastName",
  "postalCode",
  "city",
  "occupation",
  "employer",
  "email",
  "phone",
  "products",
  "callbackTime",
  "privacyConsent",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedText(value: unknown): string | null {
  const containsForbiddenControl =
    typeof value === "string" && /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
  if (typeof value !== "string" || containsForbiddenControl) {
    return null;
  }

  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function isWithinLength(value: string, maximum: number): boolean {
  return Array.from(value).length <= maximum;
}

function isProducts(value: unknown): value is readonly Product[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= PRODUCTS.length &&
    value.every(
      (product: unknown) =>
        typeof product === "string" && PRODUCTS.some((known) => known === product),
    ) &&
    new Set(value).size === value.length
  );
}

function isCallbackTime(value: unknown): value is CallbackTime {
  return typeof value === "string" && CALLBACK_TIMES.some((time) => time === value);
}

export function validateCallbackRequest(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errors: { existingCustomer: "Bitte prüfen Sie Ihre Angaben." } };
  }

  if (Object.keys(input).some((key) => !KNOWN_FIELDS.has(key))) {
    return { ok: false, errors: { existingCustomer: "Bitte prüfen Sie Ihre Angaben." } };
  }

  const errors: Partial<Record<CallbackField, string>> = {};
  const existingCustomer = input.existingCustomer;
  if (typeof existingCustomer !== "boolean") {
    errors.existingCustomer = "Bitte wählen Sie aus, ob Sie eine Kundennummer haben.";
  }

  const phone = normalizedText(input.phone);
  const phoneDigits = phone?.replace(/\D/gu, "").length ?? 0;
  if (
    phone === null ||
    !isWithinLength(phone, 30) ||
    !/^\+?[0-9][0-9 ()/-]{5,24}$/u.test(phone) ||
    phoneDigits < 6 ||
    phoneDigits > 15
  ) {
    errors.phone = "Bitte geben Sie eine gültige Telefonnummer ein.";
  }

  if (!isProducts(input.products)) {
    errors.products = "Bitte wählen Sie mindestens eine Versicherungssparte aus.";
  }

  if (!isCallbackTime(input.callbackTime)) {
    errors.callbackTime = "Bitte wählen Sie eine passende Rückrufzeit aus.";
  }

  if (input.privacyConsent !== true) {
    errors.privacyConsent = "Bitte stimmen Sie den Datenschutzhinweisen zu.";
  }

  let customerNumber: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let postalCode: string | null = null;
  let city: string | null = null;
  let occupation: string | null = null;
  let employer: string | null = null;
  let email: string | null = null;

  if (existingCustomer === true) {
    customerNumber = normalizedText(input.customerNumber);
    if (
      customerNumber === null ||
      !isWithinLength(customerNumber, 32) ||
      !/^[A-Za-z0-9/-]{4,32}$/u.test(customerNumber)
    ) {
      errors.customerNumber = "Bitte geben Sie eine gültige Kundennummer ein.";
    }
  } else if (existingCustomer === false) {
    firstName = normalizedText(input.firstName);
    if (
      firstName === null ||
      firstName.length === 0 ||
      /\p{N}/u.test(firstName) ||
      !isWithinLength(firstName, 80)
    ) {
      errors.firstName = "Bitte geben Sie Ihren Vornamen ohne Zahlen ein (maximal 80 Zeichen).";
    }

    lastName = normalizedText(input.lastName);
    if (
      lastName === null ||
      lastName.length === 0 ||
      /\p{N}/u.test(lastName) ||
      !isWithinLength(lastName, 80)
    ) {
      errors.lastName = "Bitte geben Sie Ihren Nachnamen ohne Zahlen ein (maximal 80 Zeichen).";
    }

    postalCode = normalizedText(input.postalCode);
    if (postalCode === null || !/^\d{5}$/u.test(postalCode)) {
      errors.postalCode = "Bitte geben Sie eine gültige fünfstellige Postleitzahl ein.";
    }

    city = normalizedText(input.city);
    if (city === null || city.length === 0 || !isWithinLength(city, 100)) {
      errors.city = "Bitte geben Sie Ihren Wohnort ein (maximal 100 Zeichen).";
    }

    occupation = input.occupation === undefined ? "" : normalizedText(input.occupation);
    if (occupation === null || !isWithinLength(occupation, 100)) {
      errors.occupation = "Bitte kürzen Sie Ihre Berufsangabe auf maximal 100 Zeichen.";
    }

    employer = input.employer === undefined ? "" : normalizedText(input.employer);
    if (employer === null || !isWithinLength(employer, 120)) {
      errors.employer = "Bitte kürzen Sie die Arbeitgeberangabe auf maximal 120 Zeichen.";
    }

    email = normalizedText(input.email)?.toLowerCase() ?? null;
    if (
      email === null ||
      !isWithinLength(email, 254) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
    ) {
      errors.email = "Bitte geben Sie eine gültige E-Mail-Adresse ein.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  if (
    existingCustomer === true &&
    customerNumber !== null &&
    isProducts(input.products) &&
    isCallbackTime(input.callbackTime) &&
    phone !== null
  ) {
    return {
      ok: true,
      value: {
        existingCustomer: true,
        customerNumber,
        phone,
        products: input.products,
        callbackTime: input.callbackTime,
        privacyConsent: true,
      },
    };
  }

  if (
    existingCustomer === false &&
    firstName !== null &&
    lastName !== null &&
    postalCode !== null &&
    city !== null &&
    occupation !== null &&
    employer !== null &&
    email !== null &&
    isProducts(input.products) &&
    isCallbackTime(input.callbackTime) &&
    phone !== null
  ) {
    return {
      ok: true,
      value: {
        existingCustomer: false,
        firstName,
        lastName,
        postalCode,
        city,
        ...(occupation.length > 0 ? { occupation } : {}),
        ...(employer.length > 0 ? { employer } : {}),
        email,
        phone,
        products: input.products,
        callbackTime: input.callbackTime,
        privacyConsent: true,
      },
    };
  }

  return { ok: false, errors: { existingCustomer: "Bitte prüfen Sie Ihre Angaben." } };
}
