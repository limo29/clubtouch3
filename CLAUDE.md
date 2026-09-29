# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ClubTouch3 is a German-language web POS ("Kassensystem") for a club bar: touch sales screen, member accounts with balances, stock, purchase documents, invoices, PDF/CSV reports, a live "Clubscore" highscore, and a digital-signage slide editor. UI strings, comments, commit messages and error messages are in German; keep new user-facing text in German.

Monorepo with two independent npm projects (no root package.json, no workspaces):

- `apps/backend` – Express 5 + Prisma 6 + PostgreSQL 15 + Socket.io, plain CommonJS JS (no build step; the TypeScript devDependencies are unused).
- `apps/frontend` – Create React App (react-scripts 5), React 19, MUI 7, TanStack Query 5, React Router 7.

## Commands

Run from the respective app directory. Install with `npm install` in each.

Backend (`apps/backend`):

```bash
npm run dev                    # nodemon src/server.js
npm start                      # node src/server.js
npm run prisma:generate        # regenerate client after schema changes
npm run prisma:migrate         # prisma migrate dev (creates a migration)
npm run prisma:migrate:deploy  # apply migrations (used in Docker CMD)
npm run prisma:seed            # creates admin@clubtouch3.local / Admin123! + sample articles
npm run prisma:studio
```

Frontend (`apps/frontend`):

```bash
npm start                      # CRA dev server on :3000
npm run build                  # static build into build/
npm test                       # react-scripts test (jest, watch mode)
npm test -- --watchAll=false src/components/layout/Layout.test.js   # single file
```

Backend has no test runner or linter. The `test-*.ps1` files in `apps/backend` are ad-hoc PowerShell smoke scripts that hit `http://localhost:3001/api` with the seeded admin. CI (`.github/workflows/ci.yml`) only runs `npm install` in both apps and `npm run build` in the frontend, so a broken frontend build is the only thing CI catches.

Docker (from `docker/`): `./manage.sh start|start-dev|stop|rebuild|logs-f|backup|restore|clean`, or `manage.ps1` on Windows. `docker-compose.yml` brings up db + backend + frontend (+ adminer under `--profile dev`). Note its build contexts are `./apps/...` (repo root as project dir) while `docker-compose.simple.yml` uses `../apps/...`.

### Local dev port gotcha

The CRA dev server proxies `/api` to `http://localhost:3001` (`proxy` field in `apps/frontend/package.json`), but the backend defaults to `PORT=8080` when unset. Set `PORT=3001` in `apps/backend/.env` for local development. The frontend needs no `.env`: `REACT_APP_API_URL` defaults to `/api` and `REACT_APP_WS_URL` to `/`.

### Backend environment

There is no `apps/backend/.env.example`; `docker/.env.example` and `docker/docker-compose.yml` are the reference for variable names. Required: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRE_TIME`, `JWT_REFRESH_EXPIRE_TIME`. Optional: `PORT`, `NODE_ENV`, `BCRYPT_ROUNDS`, `FRONTEND_URL` (socket CORS in production), `PUBLIC_BASE_URL` (upload URLs), `EXPORT_DIR` (defaults to `/tmp/exports`), `INVOICE_IBAN` / `INVOICE_BIC` / `INVOICE_PAYEE_NAME` / `INVOICE_REF_PREFIX`.

## Architecture

### Backend request flow

`src/server.js` → `src/app.js` (Express app, mounts all routers under `/api/*`, serves `./uploads` statically) → `src/routes/*.js` → `src/controllers/*.js` → `src/services/*.js` → `src/utils/prisma.js` (singleton PrismaClient).

- Routers apply `authenticate` (Bearer JWT, loads the user and checks `active`, sets `req.user`) and `authorize('ADMIN', 'CASHIER', ...)` from `src/middleware/auth.js`. Roles are `ADMIN | CASHIER | ACCOUNTANT`. `routes/public.js` (`/api/public/*`) is deliberately unauthenticated for kiosk screens: highscore, ads, and balance lookup by name.
- Input validation is `express-validator` chains in `src/middleware/validation.js` followed by `handleValidationErrors`.
- Controllers are classes exported as singleton instances; they catch errors and send German messages. Business logic that mutates money or stock lives in services and runs inside `prisma.$transaction`. Controllers write `AuditLog` rows after mutating calls.
- `app.js` installs a JSON replacer that converts BigInt and Prisma `Decimal` to JS numbers for every response. Raw SQL results (`$queryRaw`) still need `Number()` on the server side when used in arithmetic.
- Realtime: `src/utils/websocket.js` wraps Socket.io. Every socket joins the `highscore` room; the auth token is optional (anonymous connections allowed). `transactionService.createSale` emits `sale:new` and triggers `highscoreService.updateAfterSale`, which emits `highscore:update`.

### Domain rules encoded in services

- Sales (`transactionService`): `Transaction.type` is `SALE | REFUND | EXPIRED | OWNER_USE`. Only `SALE` has a non-zero `totalAmount`; `EXPIRED` and `OWNER_USE` ("Auf den Wirt") book stock movements with amount 0. Stock may go negative (warning + `NEGATIVE_STOCK_WARNING` audit, never a block). Paying by `ACCOUNT` enforces a hardcoded 10 EUR overdraft limit. Cancelling (`POST /transactions/:id/cancel`) works for `SALE`, `OWNER_USE` and `EXPIRED` and creates a linked `REFUND` transaction rather than deleting; for the money-less types the refund is 0 EUR and only stock goes back.
- Raw SQL against `DateTime` columns (`timestamp(3)`, naive UTC): always compare as `"createdAt" >= (${date}::timestamptz AT TIME ZONE 'UTC')`. Without the cast Postgres converts the column in the session time zone, which shifts every window by the local UTC offset on a non-UTC database (the local dev cluster is Europe/Berlin, Railway is UTC). Prisma ORM queries are unaffected.
- The "business day" starts at 06:00, not midnight (the bar night runs past midnight). `BUSINESS_DAY_START_HOUR` and `businessDayWindow()` in `src/utils/businessDay.js` are the single source for every daily window: daily summary, dashboard/transactions KPIs, exports and the Clubscore. Never call `new Date('YYYY-MM-DD')` on a query param (that is UTC midnight = 02:00 local); use `parseLocalDate` / `endOfLocalDay` from the same module. A date-only string means "that business day", a timestamp before 06:00 belongs to the previous one.
- Clubscore (`highscoreService.calculateHighscore`): daily and yearly rankings are computed live from non-cancelled `SALE` transactions of articles with `countsForHighscore` (raw SQL, top 20, revenue or quantity mode). The day is the 06:00 business day; the year is the calendar year from 1 January or from the latest `RESET_YEARLY_HIGHSCORE` `AuditLog` row of that year (reset = ADMIN button "Jahr zurücksetzen" on `/highscore`, archives both rankings in `changes`). Daily goals ("Challenges") are persisted as `AuditLog` rows (`entityType: 'HighscoreGoals'`, last one wins), not in a dedicated table. Invoice settings live in the `SystemSetting` key-value table.
- Purchasing: `PurchaseDocument` is either `RECHNUNG` (supplier invoice, money) or `LIEFERSCHEIN` (delivery note, goods); delivery notes can be attached to one invoice via `rechnungId`. Items store the final base unit plus how they were entered (purchase unit × quantity), driven by `Article.purchaseUnit` / `unitsPerPurchase`. Both document types book stock for their own items; linking/unlinking (`rechnungId`) is documentary and never moves stock, so an invoice with attached delivery notes normally carries no items of its own (`components/purchases/LinkedLieferscheineInfo.js` explains this in the UI and warns about extra items; deliberately no backend block because extra articles are legitimate). `GET /purchase-documents` filters by `startDate`, `endDate`, `supplier` (exact), `paid`, `search`; list rows include `lieferscheine[].items`, `GET /:id` includes `rechnung`.
- Accounting (`accountingService.getProfitLoss`) is the single source for EÜR numbers (UI, EÜR PDF, year-end): income = `SALE` transactions (cash + account) + paid `Invoice` (`paidAt` in range); expenses = paid `RECHNUNG` documents (`documentDate` in range). `OWNER_USE`/`EXPIRED` are never income; they are reported as `nonRevenue` (quantity + value at sale price). Top-ups are `liquidity.topUps` (cash inflow but a liability), plus `liquidity.guestBalanceEnd`, `liabilities.unpaidPurchaseDocuments`, `receivables.unpaidInvoices`. Legacy fields (`summary.*`, `details.*`) stay for the frontend.
- Cash counts (`CashCount`, `cashCountService`, `/api/cash-counts`): the till is not counted daily; a count can be made at any time. Expected = previous `countedTotal` + cash `SALE` + cash `REFUND` (negative) + cash `AccountTopUp` − cash-paid `RECHNUNG` (by `paidAt`, fallback `documentDate`) since the previous count; without a previous count the baseline is 0. `countedTotal` is computed server-side from `denominations`; the derivation is frozen in `breakdownJson`. Cancelled sales are deliberately included (the refund row books the cash going back out).
- Cash movements (`CashMovement`, `cashMovementService`, `/api/cash-movements`): till movements without a sale. Types `DEPOSIT_TO_BANK` / `OTHER_EXPENSE` reduce the till, `WITHDRAWAL_FROM_BANK` / `OTHER_INCOME` increase it; `amount` is always positive, cancelling sets `cancelled` instead of deleting. They feed the cash-count expected value (`cashCountService.getCashMovements` → `bankDeposits`, `bankWithdrawals`, `otherIncome`, `otherExpense`, frozen in `breakdownJson`). For the EÜR only `OTHER_INCOME` (income) and `OTHER_EXPENSE` (expense) count; bank deposits/withdrawals are liquidity only (`liquidity.cashMovements`). A note is mandatory for the `OTHER_*` types.
- Receipt review for the auditor (`receiptService`): `GET /api/accounting/fiscal-years/:id/receipts` and `GET /api/purchase-documents/receipts?startDate&endDate` list every `PurchaseDocument` (RECHNUNG and LIEFERSCHEIN) of the period with `hasNachweis` / `nachweisMime`; the `.zip` variants stream all upload files (named `<documentNumber>_<supplier>_<amount>.<ext>` via `archiver`) plus `Belegliste.csv` and `Belegliste.pdf`. Deliberately no tick-off/approval flag.
- Bank reconciliation (`accountingService.getBankReconciliation(start, end)`, `GET /api/accounting/bank-reconciliation?startDate&endDate` and `/fiscal-years/:id/bank-reconciliation`): expected bank balance = bank accounts of the latest closed `FiscalYear` ending before the period (`openingSource` `VORJAHRESABSCHLUSS`, else 0 and `KEIN_VORJAHR`) + `DEPOSIT_TO_BANK` + `AccountTopUp.method = TRANSFER` + paid `Invoice` (`paidAt`; invoices have no payment method, all count as bank) − `RECHNUNG` with `paymentMethod = TRANSFER` (`paidAt`, fallback `documentDate`) − `WITHDRAWAL_FROM_BANK`. There is no bank ledger: fees, membership dues and donations are outside the app, so a difference is expected and only has to be explainable. The snapshot (`detailsJson.bankReconciliation`, version 3) freezes it with `actual` (sum of entered `bankAccounts`) and `difference`; the closed-year endpoint returns `frozen: true` from the snapshot and the year-end PDF section "Bank-Abstimmung" renders from it.
- Closing a `FiscalYear` requires a cash count within `[startDate, endDate + 1 day]` (400 otherwise; `cashCountId` may be passed explicitly). `cashOnHand` comes from that count, never from the request body. The full snapshot lives in `YearEndReport.detailsJson`; the year-end PDF renders only from it once the year is closed, and as a live "ENTWURF" while it is open.
- All money and quantities are `Decimal(10,2)` in Prisma; services generally cast to `Number` for arithmetic.

### Uploads and exports

`fileUploadService` writes under `<cwd>/uploads/` (`articles/{original,thumbnail,small,medium,large}` as WebP via sharp, `nachweise/` for receipt scans); `middleware/upload.js` stores ad slide media in `uploads/ads` with a 500 MB limit. Stored URLs are relative (`/uploads/...`) so they work behind the nginx proxy. PDFs are built with PDFKit in `exportService` (theme in `getTheme()`, brand name "Clubraum").

### Frontend structure

- `src/index.js` wraps the app in `ColorModeProvider` (dark default, persisted in localStorage) → `OfflineProvider` → `BrowserRouter`; `src/App.js` adds React Query, MUI date pickers (de locale), `AuthProvider`, and the route tree. Authenticated pages render inside `components/layout/Layout.js` (drawer nav, kiosk mode via `?kiosk=1` or a `data-kiosk` attribute on body). `/public/highscore`, `/public/ads` and `/check-balance` sit outside the auth shell.
- `src/services/api.js` is the single axios instance: it attaches the Bearer token from localStorage and transparently refreshes on 401 via `/auth/refresh`, redirecting to `/login` on failure. Endpoint paths are constants in `src/config/api.js`.
- Data fetching is TanStack Query directly in page components (`src/pages/*.js`); pages are large single files that own their dialogs and mutations. There is no per-resource API layer.
- Offline: `context/OfflineContext.js` keeps a localStorage queue of sales and top-ups; `Sales.js` enqueues when `navigator.onLine` is false and the queue drains sequentially on reconnect. 4xx failures currently stay in the queue.
- The live highscore uses `hooks/useHighscoreLogic.js` (socket.io-client against `WS_URL`, event `highscore:update`, plus 60 s polling). `apps/frontend/.env.development` sets `REACT_APP_WS_URL=http://localhost:3001` so the socket bypasses the CRA proxy: the `proxy` field dies with an unhandled `ECONNRESET` whenever a proxied WebSocket drops (every backend restart) and takes the dev server with it.
- Finance UI: `pages/CashCount.js` (`/cash-count`, "Kasse zählen") is the only place a till count is entered (14 denominations via `components/common/QuantityStepper.js`, expected value from `/cash-counts/preview`, list under query key `['cash-counts', …]`). `pages/ProfitLoss.js` (`/profit-loss`) is "Kassenprüfung" with tabs EÜR / Kasse & Bank / Geschäftsjahre; closing a year runs through `components/finance/CloseYearStepper.js` (6 steps: Zeitraum, Kasse, Bank, Belege, Inventur, Prüfen; inventory in crates + singles via `utils/units.js`, payload `physicalInventory` in base units, `cashCountId` instead of `cashOnHand`). `components/finance/BankReconciliation.js` (props `data`, `actual`, `compact`, `loading`) is the shared bank derivation + movement table, used in the "Bank" step (live Ist/Differenz from the account inputs, `preview.bankReconciliation`) and on the "Kasse & Bank" tab (query key `['bank-reconciliation', from, to]`, shares its date range with the cash-movement list). `pages/Reports.js` keeps one parameter object per report id. Authenticated file downloads go through `utils/download.js` (`downloadFile`, `apiErrorMessage` also reads Blob error bodies).
- `/cash-count` also books cash movements (card "Kassenbewegung buchen", list via `components/finance/CashMovementList.js`, query keys `['cash-movements', …]`; invalidate `['cash-counts']` too). `components/finance/ReceiptReview.js` (props `fetchUrl`, `zipUrl`, `params`, `title`, `onSummary`) is the shared receipt table + preview (img / iframe on the public `/uploads/...` URL) used by the "Belege" step of `CloseYearStepper.js` and the "Belege prüfen" dialog on the EÜR tab.
- MUI 7 Grid: always `<Grid size={{ xs: 12, md: 6 }}>`; the old `item xs={…}` props are silently ignored and break the layout (this was the cause of the article dialog overflowing). Form dialogs use `PaperProps={{ component: 'form' }}` so `DialogContent` scrolls and the actions stay visible, and `fullScreen` below `sm`. Pages render inside a column-flex `main` with `minWidth: 0`, so wide Tabs/Tables must scroll inside their container instead of widening the page.

### Artikel buchen (Verkauf, Einkauf, Rechnung)

- One component for all three: `components/articles/ArticleLinePicker.js` (`mode="sale"|"purchase"|"invoice"`, search + category tabs + tile grid + line list; the page supplies `sidebar`, `linesHeader`, `linesFooter`). Below `md` it renders tabs `<sidebarLabel> | Artikel | <linesLabel> (n)`; from `md` three columns. `showCrates`/`editablePrice`/`allowFreeLines` default per mode: crates and free lines only outside sales, editable price only on invoices.
- Articles come from `hooks/useArticles.js` (single query key `['articles']`, normalized once: `price`/`stock` numbers, `unitsPerPurchase >= 1`, `unit`/`purchaseUnit` fallbacks). Invalidate `ARTICLES_QUERY_KEY` after anything that moves stock.
- Line model in `hooks/useArticleLines.js` keeps crates and singles separate (`crateQty`, `baseQty`); sales never set `crateQty`. `utils/units.js` converts (`toBaseUnits`, `describeLineQty` → "2 Kisten + 3 Fl. = 43 Flaschen"), `utils/format.js` formats money (`2,50 €`) and integer quantities.
- Backend payloads are produced only by the serializers `toSalePayload` (`{articleId, quantity}`), `toPurchasePayload` (`{articleId, kisten, flaschen}`, conversion stays in the backend) and `toInvoicePayload` (`{articleId|null, description, quantity, pricePerUnit}` in base units); `linesFromPurchaseItems`/`linesFromInvoiceItems` rebuild lines when editing.

### Deployment

Railway (`railway.toml`) deploys two services from the per-app Dockerfiles. The backend container runs `prisma migrate deploy` then `node src/server.js`. The frontend container builds the CRA app and serves it with nginx; `nginx.conf` is an envsubst template that proxies `/api`, `/uploads` and `/socket.io` to `$BACKEND_URL`, so the SPA only talks to same-origin paths.

## Repo notes

- `apps/backend/index.js` is a leftover hello-world server; the real entry is `src/server.js`.
- `README.md` is UTF-16 encoded; read it with `Get-Content -Encoding Unicode` or an editor, not `cat`.
- Migrations live in `apps/backend/prisma/migrations`; add a migration with `npm run prisma:migrate` rather than editing the schema alone.
- Work happens on branches `dev` / `public-dev` and is merged to `main` via PRs.
