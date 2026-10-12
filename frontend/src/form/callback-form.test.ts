// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendCallbackRequest } from "../api/callback-api";
import { initializeCallbackForm } from "./callback-form";

vi.mock("../api/callback-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/callback-api")>();
  return {
    ...actual,
    sendCallbackRequest: vi.fn(),
  };
});

const formMarkup = `
  <form id="callback-form" novalidate>
    <fieldset id="existing-customer-fields" hidden>
      <input name="customerNumber" id="customerNumber">
      <p id="customerNumber-error"></p>
    </fieldset>
    <fieldset id="new-customer-fields" hidden>
      <input name="firstName" id="firstName">
      <p id="firstName-error"></p>
      <input name="lastName" id="lastName">
      <p id="lastName-error"></p>
      <input name="postalCode" id="postalCode">
      <p id="postalCode-error"></p>
      <input name="city" id="city">
      <p id="city-error"></p>
      <input name="occupation" id="occupation">
      <p id="occupation-error"></p>
      <input name="employer" id="employer">
      <p id="employer-error"></p>
      <input name="email" id="email" type="email">
      <p id="email-error"></p>
    </fieldset>
    <input type="radio" name="existingCustomer" value="yes">
    <input type="radio" name="existingCustomer" value="no">
    <p id="existingCustomer-error"></p>
    <input name="phone" id="phone">
    <p id="phone-error"></p>
    <input type="checkbox" name="products" id="product-car" value="car">
    <p id="products-error"></p>
    <select name="callbackTime" id="callbackTime">
      <option value="morning">Morning</option>
      <option value="afternoon">Afternoon</option>
    </select>
    <p id="callbackTime-error"></p>
    <input type="checkbox" name="privacyConsent" id="privacyConsent" value="on">
    <p id="privacyConsent-error"></p>
    <button id="submit-button" type="submit">Submit</button>
    <div id="form-status" class="form-status" role="status" tabindex="-1"></div>
  </form>
`;

function control<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing test control: ${id}`);
  }
  return element as T;
}

function chooseCustomerStatus(status: "yes" | "no"): void {
  const radio = document.querySelector<HTMLInputElement>(
    `input[name="existingCustomer"][value="${status}"]`,
  );
  if (!radio) {
    throw new Error(`Missing customer status radio: ${status}`);
  }
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillProspectiveCustomerForm(): void {
  chooseCustomerStatus("no");
  control<HTMLInputElement>("firstName").value = "Mara";
  control<HTMLInputElement>("lastName").value = "Beispiel";
  control<HTMLInputElement>("postalCode").value = "50667";
  control<HTMLInputElement>("city").value = "Köln";
  control<HTMLInputElement>("occupation").value = "Ingenieurin";
  control<HTMLInputElement>("employer").value = "Beispiel GmbH";
  control<HTMLInputElement>("email").value = "mara@example.test";
  control<HTMLInputElement>("phone").value = "+49 221 1234567";
  control<HTMLInputElement>("product-car").checked = true;
  control<HTMLSelectElement>("callbackTime").value = "morning";
  control<HTMLInputElement>("privacyConsent").checked = true;
}

function submitForm(): void {
  const form = control<HTMLFormElement>("callback-form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = formMarkup;
  vi.mocked(sendCallbackRequest).mockReset().mockResolvedValue(undefined);
  initializeCallbackForm();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("callback form", () => {
  it("discloses the selected customer fields and clears irrelevant data", () => {
    control<HTMLInputElement>("firstName").value = "Mara";
    control<HTMLInputElement>("customerNumber").value = "87654321";

    chooseCustomerStatus("yes");

    expect(control<HTMLFieldSetElement>("existing-customer-fields").hidden).toBe(false);
    expect(control<HTMLFieldSetElement>("new-customer-fields").hidden).toBe(true);
    expect(control<HTMLInputElement>("firstName").value).toBe("");
    expect(control<HTMLInputElement>("customerNumber").value).toBe("87654321");

    chooseCustomerStatus("no");

    expect(control<HTMLFieldSetElement>("existing-customer-fields").hidden).toBe(true);
    expect(control<HTMLFieldSetElement>("new-customer-fields").hidden).toBe(false);
    expect(control<HTMLInputElement>("customerNumber").value).toBe("");
  });

  it("shows an accessible field error after blur", () => {
    chooseCustomerStatus("no");
    const firstName = control<HTMLInputElement>("firstName");

    firstName.dispatchEvent(new Event("blur"));

    expect(control<HTMLElement>("firstName-error").textContent).toBe(
      "Bitte geben Sie Ihren Vornamen ein (maximal 80 Zeichen).",
    );
    expect(firstName.getAttribute("aria-invalid")).toBe("true");
    expect(firstName.getAttribute("aria-describedby")).toContain("firstName-error");
  });

  it("focuses the first invalid field and does not send an invalid request", () => {
    chooseCustomerStatus("no");
    submitForm();

    expect(document.activeElement).toBe(control<HTMLInputElement>("firstName"));
    expect(sendCallbackRequest).not.toHaveBeenCalled();
  });

  it("sends valid details and presents an announced success state", async () => {
    fillProspectiveCustomerForm();
    submitForm();

    await vi.waitFor(() => {
      expect(sendCallbackRequest).toHaveBeenCalledWith({
        existingCustomer: false,
        firstName: "Mara",
        lastName: "Beispiel",
        postalCode: "50667",
        city: "Köln",
        occupation: "Ingenieurin",
        employer: "Beispiel GmbH",
        email: "mara@example.test",
        phone: "+49 221 1234567",
        products: ["car"],
        callbackTime: "morning",
        privacyConsent: true,
      });
    });
    expect(control<HTMLElement>("form-status").className).toBe("form-status success");
    expect(control<HTMLElement>("form-status").textContent).toContain(
      "Ihre Rückrufanfrage wurde übermittelt",
    );
    expect(control<HTMLButtonElement>("submit-button").disabled).toBe(true);
  });

  it("preserves entered values and permits retry after an API error", async () => {
    vi.mocked(sendCallbackRequest).mockRejectedValueOnce(new Error("Service unavailable"));
    fillProspectiveCustomerForm();
    submitForm();

    await vi.waitFor(() => {
      expect(control<HTMLElement>("form-status").className).toBe("form-status error");
    });

    expect(control<HTMLInputElement>("firstName").value).toBe("Mara");
    expect(control<HTMLElement>("form-status").textContent).toBe("Service unavailable");
    expect(control<HTMLButtonElement>("submit-button").disabled).toBe(false);
    expect(control<HTMLButtonElement>("submit-button").textContent).toBe("Erneut versuchen");
  });
});
