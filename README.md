# DEVK Callback Request

A framework-free full-stack application with independently deployable frontend and backend. The frontend uses HTML, CSS, and TypeScript, is built with Vite, and can run as a static site on GitHub Pages. A Cloudflare Worker API validates requests and stores HTML files in a private R2 bucket. The downstream email service is outside the scope of this project.


## Structure

```text
frontend/          HTML, SCSS, browser TypeScript, Vite, and GitHub Pages build
backend/           Cloudflare Worker API, R2 binding, and API tests
shared/            Explicit JSON contract and pure business validation
.github/workflows/ GitHub Pages and Cloudflare Worker workflows
```

The frontend and backend are built and deployed separately. `shared/callback-request.ts` contains the shared request types and allowed-value constants; `shared/callback-validation.ts` contains the pure validation and normalization logic used by both the browser and Worker. The Worker remains the security boundary and validates every request again.

Frontend styles are maintained as SCSS under `frontend/src/styles/`: `_general.scss` contains resets and global styles, `_layout.scss` contains the header and hero, `_form.scss` contains form components, `_responsive.scss` contains breakpoints and reduced-motion rules, and `_tokens.scss` is the single source for every color and breakpoint value. `styles.scss` is the Vite entry point; Sass compiles and bundles these partials without a runtime dependency.

The frontend entry point, `frontend/src/main.ts`, loads the styles and initializes the form controller in `frontend/src/form/callback-form.ts`. API request construction and transport are kept separately in `frontend/src/api/callback-api.ts`.

## Local development

Requirements: Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev:backend
```

In a second terminal:

```sh
npm run dev
```

The Vite development server runs at `http://localhost:5173` and proxies `/api` requests to the local Worker. Wrangler emulates R2 locally. Frontend changes do not require Cloudflare access; the API does not require a real bucket during local development.

## GitHub Pages: frontend

The `.github/workflows/deploy-pages.yml` workflow builds and deploys only `frontend/` to GitHub Pages. In the repository, go to **Settings → Pages** and select **GitHub Actions** as the build and deployment source. Also add this repository variable under **Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
| --- | --- |
| `VITE_API_BASE_URL` | The deployed Worker origin, e.g. `https://<worker>.<account>.workers.dev` (without a trailing slash) |

The workflow intentionally fails if the API origin is missing rather than publishing a site with a non-functional form. It builds with the project path `/callback-form/` and adjusts that path automatically if the repository is renamed.

## Backend request flow

The backend is a Cloudflare Worker with a single endpoint, `POST /api/callback-requests`. The Pages frontend sends JSON to the Worker origin configured at build time with `VITE_API_BASE_URL`; it does not send requests to the Pages host. The Worker uses the `CALLBACK_REQUESTS` R2 binding for persistence. `FRONTEND_ORIGIN` in `backend/wrangler.toml` is the one allowed browser origin (`https://elenakapp.github.io` by default).

For each request, the Worker:

1. Requires the request path to match `/api/callback-requests` and the `Origin` header to match `FRONTEND_ORIGIN`. A request from a different or missing origin is rejected with `403`.
2. Handles CORS preflight requests with `OPTIONS` only for the allowed origin, a requested `POST` method, and no requested header other than `Content-Type`. It permits no credentials.
3. Accepts only `POST` (other methods receive `405`) and `Content-Type: application/json` (otherwise `415`).
4. Reads at most 16 KiB of UTF-8 JSON. Oversized bodies receive `413`; missing, malformed, or unreadable JSON receives `400`.
5. Validates the untrusted JSON using the shared `validateCallbackRequest` rules. The top-level value must be an object containing only recognized fields. Text is Unicode-normalized (NFC), trimmed, and whitespace-collapsed; control characters are rejected. Phone numbers are limited to 30 characters and 6–15 digits. Callback time must be `morning` or `afternoon`; `products` must contain one or more unique values from `car`, `home`, `liability`, `legal`, `health`, and `other`.
6. Enforces the customer-data branch on the server. With `existingCustomer: true`, a 4–32 character customer number is required; personal details from the other branch are omitted from the normalized data. With `existingCustomer: false`, first name (1–80 characters), last name (1–80), five-digit postal code, city (1–100), and valid email (up to 254) are required; occupation (up to 100) and employer (up to 120) are optional. Email is lowercased. Both branches also require a valid phone number, callback time, at least one product, and `privacyConsent: true`. Invalid requests receive `400`; unknown fields are rejected rather than silently persisted.
7. Builds a new, explicitly selected `CallbackRequest` object rather than storing the raw request. It generates a random UUID, escapes user-supplied text for HTML, and renders a complete German-language HTML document with a restrictive Content Security Policy.
8. Writes the document to the private R2 bucket using the key `callback-requests/{UUID}.html` and content type `text/html; charset=utf-8`. User input never influences the object key. A storage failure returns `503`; success returns `202` with only `{ "status": "accepted" }`.

The Worker does not send email or return the stored HTML to the browser. A separate downstream service is expected to retrieve the HTML files from R2 and process them; that service is outside this application.

## Security and privacy

- The CORS allowlist contains only the configured frontend origin; credentials and cookies are not allowed. CORS is a browser security mechanism and does not replace authentication or rate limiting. Add a Cloudflare rate-limit/WAF rule for the public request endpoint in production.
- The Worker enforces request size, method, content type, origin, field names, field lengths, formats, and fixed enumerations on the server. When the customer status changes, the browser sends only the selected data variant and clears irrelevant fields.
- The HTML document is generated from an explicit, validated data object. Text is escaped before insertion into text nodes; the document contains no user data in scripts or attributes and includes a restrictive CSP. The R2 bucket must not be publicly accessible.
- Responses contain no stored user data, UUID, or object paths. Form input is preserved if storage or network errors occur.
- Callback details are personal data. Restrict access to R2 and the downstream email service, and define deletion and retention periods. The downstream email service must continue to treat HTML files as untrusted. Review the privacy notice and legal basis against the actual processing workflow before production use.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm run build:backend
```
