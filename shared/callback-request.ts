export const PRODUCTS = [
  "car",
  "home",
  "liability",
  "legal",
  "health",
  "other",
] as const;

export const CALLBACK_TIMES = ["morning", "afternoon"] as const;

export type Product = (typeof PRODUCTS)[number];
export type CallbackTime = (typeof CALLBACK_TIMES)[number];

interface CallbackRequestBase {
  readonly phone: string;
  readonly products: readonly Product[];
  readonly callbackTime: CallbackTime;
  readonly privacyConsent: true;
}

export type CallbackRequest = CallbackRequestBase &
  (
    | { readonly existingCustomer: true; readonly customerNumber: string }
    | {
        readonly existingCustomer: false;
        readonly firstName: string;
        readonly lastName: string;
        readonly postalCode: string;
        readonly city: string;
        readonly occupation?: string;
        readonly employer?: string;
        readonly email: string;
      }
  );

export type CallbackField =
  | "existingCustomer"
  | "customerNumber"
  | "firstName"
  | "lastName"
  | "postalCode"
  | "city"
  | "occupation"
  | "employer"
  | "email"
  | "phone"
  | "products"
  | "callbackTime"
  | "privacyConsent";

export type ValidationResult =
  | { readonly ok: true; readonly value: CallbackRequest }
  | {
      readonly ok: false;
      readonly errors: Partial<Record<CallbackField, string>>;
    };
