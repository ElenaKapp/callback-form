import {
  type CallbackField,
  type CallbackRequest,
} from "../../../shared/callback-request";
import { validateCallbackRequest } from "../../../shared/callback-validation";
import { buildCallbackPayload, sendCallbackRequest } from "../api/callback-api";

export function initializeCallbackForm(): void {
  function requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) {
      throw new Error("Das Rückrufformular konnte nicht geladen werden.");
    }
    return element;
  }

  const form = requireElement<HTMLFormElement>("#callback-form");
  const status = requireElement<HTMLDivElement>("#form-status");
  const submitButton = requireElement<HTMLButtonElement>("#submit-button");
  const existingFields = requireElement<HTMLFieldSetElement>("#existing-customer-fields");
  const newFields = requireElement<HTMLFieldSetElement>("#new-customer-fields");

  const fieldNames: readonly CallbackField[] = [
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
  ];
  const touchedFields = new Set<CallbackField>();
  let submitAttempted = false;
  let submitted = false;

  function getControl(field: CallbackField): HTMLElement | null {
    if (field === "existingCustomer") {
      return form.querySelector<HTMLInputElement>('input[name="existingCustomer"]:checked');
    }
    if (field === "products") {
      return form.querySelector<HTMLInputElement>('input[name="products"]');
    }
    const control = form.elements.namedItem(field);
    return control instanceof HTMLElement ? control : null;
  }

  function getControls(field: CallbackField): readonly HTMLElement[] {
    if (field === "existingCustomer") {
      return [...form.querySelectorAll<HTMLInputElement>('input[name="existingCustomer"]')];
    }
    if (field === "products") {
      return [...form.querySelectorAll<HTMLInputElement>('input[name="products"]')];
    }
    const control = getControl(field);
    return control ? [control] : [];
  }

  function getPayload(): Record<string, unknown> | null {
    const selectedOption = form.querySelector<HTMLInputElement>('input[name="existingCustomer"]:checked');
    if (!selectedOption) {
      return null;
    }

    return buildCallbackPayload(selectedOption.value === "yes", new FormData(form));
  }

  function showError(field: CallbackField, message: string): void {
    const error = document.getElementById(`${field}-error`);
    if (error) {
      error.textContent = message;
    }
    for (const control of getControls(field)) {
      control.setAttribute("aria-invalid", "true");
      const describedBy = (control.getAttribute("aria-describedby") ?? "")
        .split(/\s+/u)
        .filter(Boolean);
      if (!describedBy.includes(`${field}-error`)) {
        describedBy.push(`${field}-error`);
      }
      control.setAttribute("aria-describedby", describedBy.join(" "));
    }
  }

  function clearError(field: CallbackField): void {
    const error = document.getElementById(`${field}-error`);
    if (error) {
      error.textContent = "";
    }
    for (const control of getControls(field)) {
      control.removeAttribute("aria-invalid");
      const describedBy = (control.getAttribute("aria-describedby") ?? "")
        .split(/\s+/u)
        .filter((id) => id && id !== `${field}-error`);
      if (describedBy.length > 0) {
        control.setAttribute("aria-describedby", describedBy.join(" "));
      } else {
        control.removeAttribute("aria-describedby");
      }
    }
  }

  function validateAndRender(payload: unknown): boolean {
    const result = validateCallbackRequest(payload);
    const currentErrors = result.ok ? {} : result.errors;

    for (const field of fieldNames) {
      if (field in currentErrors) {
        if (submitAttempted || touchedFields.has(field)) {
          showError(field, currentErrors[field] ?? "");
        }
      } else {
        clearError(field);
      }
    }
    return result.ok;
  }

  function updateCustomerFields(selected: string): void {
    const isExisting = selected === "yes";
    existingFields.hidden = !isExisting;
    newFields.hidden = isExisting;
    status.className = "form-status";
    status.textContent = "";

    const irrelevantFields: readonly CallbackField[] = isExisting
      ? [
          "firstName",
          "lastName",
          "postalCode",
          "city",
          "occupation",
          "employer",
          "email",
        ]
      : ["customerNumber"];
    for (const field of irrelevantFields) {
      const control = form.elements.namedItem(field);
      if (control instanceof HTMLInputElement) {
        control.value = "";
      }
      clearError(field);
      touchedFields.delete(field);
    }
    clearError("existingCustomer");
  }

  for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="existingCustomer"]')) {
    radio.addEventListener("change", () => updateCustomerFields(radio.value));
    radio.addEventListener("blur", () => {
      touchedFields.add("existingCustomer");
      validateAndRender(getPayload());
    });
  }

  for (const field of fieldNames) {
    if (field === "existingCustomer") {
      continue;
    }
    for (const fieldControl of getControls(field)) {
      fieldControl.addEventListener("blur", () => {
        touchedFields.add(field);
        validateAndRender(getPayload());
      });
      fieldControl.addEventListener("input", () => {
        if (touchedFields.has(field) || submitAttempted) {
          validateAndRender(getPayload());
        }
      });
      fieldControl.addEventListener("change", () => {
        if (touchedFields.has(field) || submitAttempted) {
          validateAndRender(getPayload());
        }
      });
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitted) {
      return;
    }
    submitAttempted = true;
    status.textContent = "";

    const payload = getPayload();
    if (!payload || !validateAndRender(payload)) {
      const firstError = fieldNames.find((field) => {
        const message = document.getElementById(`${field}-error`)?.textContent;
        return Boolean(message);
      });
      (firstError ? getControl(firstError) : form.querySelector<HTMLInputElement>('input[name="existingCustomer"]'))?.focus();
      return;
    }

    const result = validateCallbackRequest(payload);
    if (!result.ok) {
      return;
    }

    const request: CallbackRequest = result.value;
    submitButton.disabled = true;
    submitButton.textContent = "Wird übermittelt …";
    try {
      await sendCallbackRequest(request);
      submitted = true;
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")
        .forEach((control) => { control.disabled = true; });
      status.className = "form-status success";
      status.textContent = "Vielen Dank. Ihre Rückrufanfrage wurde übermittelt. Wir melden uns zum gewünschten Zeitpunkt bei Ihnen.";
      submitButton.textContent = "Rückrufanfrage übermittelt";
      status.focus();
    } catch (error: unknown) {
      status.className = "form-status error";
      status.textContent = error instanceof Error
        ? error.message
        : "Ihre Anfrage konnte gerade nicht übermittelt werden. Bitte versuchen Sie es erneut.";
      status.focus();
    } finally {
      if (!submitted) {
        submitButton.disabled = false;
        submitButton.textContent = "Erneut versuchen";
      }
    }
  });
}
