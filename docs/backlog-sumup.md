# Backlog: SumUp-Kartenterminal in ClubTouch3 integrieren (Recherche)

Stand der Recherche: 29.09.2026. Ausgangsfrage des Betreibers: „wir haben auch ein SumUp-Terminal, recherchiere vielleicht mal wie/ob man das relativ einfach integrieren könnte“.

Kennzeichnung im Text: **[Fakt]** = mit Quelle belegt (Nummer verweist auf die Quellenliste am Ende), **[Annahme]** = eigene Einschätzung/Ableitung ohne direkte Quelle.

## Kurzfazit

1. Ja, geht – aber nur mit einem **SumUp Solo** (inkl. „Solo und Drucker“): Nur die Solo-Familie kann per **Cloud API** vom Server aus angesteuert werden; **Solo Lite, Air, 3G, PIN+** sind reine Bluetooth-Geräte für native Android/iOS-Apps und aus einer Web-App **nicht** erreichbar [2][4][5][6].
2. Der Ablauf passt gut zu unserer Architektur: Backend `POST /v0.1/merchants/{merchant_code}/readers/{reader_id}/checkout` → Solo fordert Karte an → Ergebnis kommt als Webhook (`return_url`, HTTPS, öffentlich – Railway erfüllt das) und ist zusätzlich per Transactions API abfragbar [2][3][9].
3. Voraussetzungen sind gering: bestehendes SumUp-Konto, API-Key (`sup_sk_…`) und Affiliate-Key aus dem Dashboard, Sandbox-Konto + „Virtual Solo“ zum Testen ohne Gerät; keine Zusatzgebühren für die API, es bleibt bei 1,39 % pro Kartenzahlung (Standardtarif DE) [7][8][10][11][15][16].
4. Empfohlene Stufen: (a) Zahlungsart „Karte“ nur als Buchungsmerkmal, Terminal manuell – ca. 1–2 Tage; (b) Reader-API-Anbindung mit Webhook + Polling + Storno-Timeout – ca. 5–8 Tage; (c) Refund per API + Tagesabgleich mit SumUp-Transaktions-/Auszahlungsliste in der Kassenprüfung – weitere 3–5 Tage. Stufe (a) ist unabhängig sinnvoll, weil Kartenumsätze sonst in EÜR und Kassenzählung falsch landen.
5. Größte Stolpersteine: der Solo muss für die Cloud API **aus der SumUp-App ausgeloggt** sein (kein paralleler „manueller“ Betrieb), 60-Sekunden-Fenster pro Checkout, Webhook ohne dokumentierte Signatur (Ergebnis immer per API gegenprüfen), lokale Entwicklung braucht Tunnel oder Polling, und die TSE/KassenSichV-Frage stellt sich für ClubTouch3 unabhängig von SumUp [2][3][12][19][20].

---

## 1. Integrationswege bei SumUp (Stand 2026)

### 1.1 Überblick

SumUp unterteilt seine Entwicklerangebote in „In-Person Payments“ (Terminal) und „Online Payments“ [1][13]. Für Terminalzahlungen gibt es drei Wege [1]:

| Weg | Was | Aus dem Browser nutzbar? |
|---|---|---|
| **Cloud API** („Readers API“, früher „Solo API“) | Server legt per REST einen Checkout auf einem gekoppelten Reader an; Ergebnis per Webhook/Abfrage | **Ja** (Server → SumUp; das Frontend spricht nur mit unserem Backend) [2] |
| **Reader SDKs** (Android/iOS) | Native App koppelt Air/Solo Lite/Solo per Bluetooth | Nein, nur native Apps [1][4][5] |
| **Payment Switch** | App-zu-App-Übergabe per URL-Schema `sumupmerchant://pay/1.0?…` an die SumUp-App | Nur aus nativen Apps dokumentiert; laut SumUp „legacy fallback“, wird nicht weiterentwickelt [14] |

**[Fakt]** Die Cloud API ist laut SumUp dafür gedacht, „eine Transaktion von einem POS auf beliebiger Plattform (Windows, iOS, Linux, Android, Web-basiert, …), die HTTPS-Requests senden kann“, zu starten und über einen Solo abzuschließen [2][21]. Genau unser Fall.

**[Fakt]** Zusätzlich gibt es die **Online Payments** (Hosted Checkout, Card Widget, Checkouts API) – das sind Fernzahlungen ohne Terminal, mit dem höheren Online-Gebührensatz [13][15]. Für den Thekenverkauf uninteressant; denkbar später für Online-Guthabenaufladung (nicht Teil dieses Backlog-Punkts).

**[Fakt]** Für den Abgleich gibt es die **Transactions API** (`GET /v2.1/merchants/{merchant_code}/transactions` mit `client_transaction_id`, `/transactions/history` mit Zeit-/Status-Filtern) [9] und die **Payouts API** (`GET /v1.0/merchants/{merchant_code}/payouts?start_date&end_date`, liefert je Auszahlung/Abzug `amount`, `fee`, `transaction_code`, `type`) [17].

### 1.2 Welche Reader-Modelle serverseitig ansteuerbar sind

| Modell | Cloud API | Anbindung | Quelle |
|---|---|---|---|
| **Solo** | **Ja** („the right reader family when you need the current server-driven Cloud API“) | WLAN, eigene SIM, Bluetooth; eigenes Touch-Display | [6] |
| **Solo und Drucker** | **[Annahme]** Ja – ist laut Produktseiten ein Solo mit Bondrucker-Dock, technisch derselbe Reader (WLAN + integrierte SIM) | [18] |
| **Go** | Ja, aber nur in Australien, Mexiko, Kanada verfügbar | – | [22] |
| **Solo Lite** | **Nein** – nur Android/iOS SDK und Payment Switch, hängt an der SumUp-App per Bluetooth | Bluetooth | [4] |
| **Air** | **Nein** – nur SDKs/Payment Switch, „depends on a paired device for checkout and network access“ | Bluetooth | [5] |
| **3G**, **PIN+** | Nicht als Cloud-API-fähig gelistet; 3G ist „standalone mobile payments“ ohne API-Anbindung | – | [23] |

**[Fakt]** Das Reader-Objekt der API kennt als `device.model` nur `solo` und `virtual-solo` [3].

**Wichtig für den Betreiber: Welches Modell steht im Clubraum?** Steht ein Solo Lite oder Air dort, ist eine automatische Anbindung an eine Web-App nicht möglich (nur Stufe (a) unten, Terminal manuell bedienen, oder Neukauf eines Solo, Listenpreis Solo laut Preisseiten im Bereich 79–109 € [18] **[Annahme: Preise schwanken, nur Größenordnung]**).

### 1.3 Zahlen aus der Web-App ohne native App

**[Fakt]** Ja – über die Cloud API. Der Browser braucht keinerlei Verbindung zum Reader; unser Backend spricht mit `api.sumup.com`, der Solo bekommt den Zahlungsauftrag über seine eigene Internetverbindung (WLAN oder SIM) [2][21].
**[Fakt]** Ein direkter Bluetooth-Zugriff aus dem Browser (Web Bluetooth) ist von SumUp nicht angeboten; die SDKs sind Android/iOS-only [1][4][5].
**[Annahme]** Payment Switch (`sumupmerchant://…`) lässt sich zwar theoretisch als Link aus einem mobilen Browser öffnen, aber der Rückkanal (`callback`-URI in die eigene App) ist für Web nicht vorgesehen und SumUp stuft den Weg als Legacy ein [14] – nicht weiterverfolgen.

### 1.4 Die Cloud API im Detail

Alle Pfade relativ zu `https://api.sumup.com` [2][3]:

| Schritt | Endpoint | Hinweise |
|---|---|---|
| Reader koppeln | `POST /v0.1/merchants/{merchant_code}/readers` mit `pairing_code` | Code wird am Solo erzeugt (Menü Verbindungen → WLAN → API → Verbinden), gilt 5 Minuten; Solo muss vorher **ausgeloggt** sein [2] |
| Reader auflisten/prüfen | `GET …/readers`, `GET …/readers/{id}`, `GET …/readers/{id}/status` | Status: `ONLINE`/`OFFLINE`, Gerätezustand `IDLE`, `SELECTING_TIP`, `WAITING_FOR_CARD`, `WAITING_FOR_PIN`, `WAITING_FOR_SIGNATURE`, `UPDATING_FIRMWARE`; Reader-Status `paired`/`expired`/`processing`/`unknown` [3][24] |
| Zahlung starten | `POST …/readers/{id}/checkout` | Body: `total_amount: {currency:"EUR", minor_unit:2, value:1500}` (= 15,00 €), optional `description`, `return_url` (HTTPS, öffentlich), `tip_rates` (0.01–0.99, aufsteigend), `tip_timeout`, `card_type`, `installments`, `affiliate {app_id, key, foreign_transaction_id, tags}`; Antwort `checkout_id` + `client_transaction_id` (HTTP 201) [2][3] |
| Checkout abfragen | `GET …/readers/{id}/checkout/{checkout_id}` | Liefert Checkout-Details/Transaktionsstatus [3] |
| Abbrechen | `POST …/readers/{id}/terminate` | Nur solange das Gerät auf den Kunden wartet (Karte, PIN …); bei Erfolg kommt Webhook mit `status: failed` [2] |
| Ergebnis | Webhook an `return_url` | `{"event_type":"solo.transaction.updated","payload":{"client_transaction_id":…,"merchant_code":…,"status":"successful"|"failed","failure_reason":…},"timestamp":…}`; `failure_reason` ist Freitext, nicht matchen [2] |
| Nachschlagen | `GET /v2.1/merchants/{merchant_code}/transactions?client_transaction_id=…` | Status `PENDING`/`SUCCESSFUL`/`FAILED`/`CANCELLED`/`REFUNDED`, `amount`, `tip_amount`, `payout_date`, `card.type`, `entry_mode`, `transaction_events` [9] |
| Erstattung | `POST /v1.0/merchants/{merchant_code}/payments/{transaction_id}/refunds` | optional `amount` für Teilerstattung; 409 wenn nicht erstattbar; Scopes `payments` oder `refunds.write` [12] |

**[Fakt]** Zeitfenster: Nach Annahme des Checkouts hat das System 60 Sekunden, die Zahlung auf dem Gerät zu starten; solange wird jeder weitere Checkout für denselben Reader abgelehnt. Der Reader muss online sein [2].
**[Fakt]** Scopes für Reader-Checkouts: `readers.write` oder `terminals.write`; Permission `readers.checkouts.create` [3]. Transaktionen lesen: `transactions.history` oder `transactions.read` [9]. Payouts: `payouts.read` [17].
**[Fakt]** Seit 22.12.2025 liefert die Cloud API Echtzeit-Statusupdates der Reader (IDLE, WAITING_FOR_CARD …) [24].
**[Fakt]** Offizielles Node-SDK: `@sumup/sdk` (npm, Node ≥ 18, CommonJS + ESM, Apache-2.0, noch vor v1, mit Beispiel „card-reader-checkout“) [25][26]. **[Annahme]** Für unseren Umfang reicht auch `fetch` gegen die REST-API; das SDK spart Typen/Retry-Boilerplate, bringt aber Pre-1.0-Risiko.

---

## 2. Voraussetzungen

| Punkt | Befund |
|---|---|
| SumUp-Konto | Bestehendes Händlerkonto genügt; Dashboard `me.sumup.com` [7]. **[Fakt]** Kein gesonderter Developer-Vertrag; Entwicklerfunktionen sitzen unter Einstellungen → „Für Entwickler“ [7][8]. |
| API-Key | Einstellungen → For Developers → Toolkit → API Keys → „Create“; Secret Key `sup_sk_…`, wird nur einmal angezeigt; Header `Authorization: Bearer $SUMUP_API_KEY`. Public Key `sup_pk_…` nicht verwenden [7]. API-Keys sind statische Credentials für „direct server-to-server integrations when you control the merchant account and need full API access“ – OAuth ist nur für Multi-Händler-Integrationen nötig [10][11]. |
| Affiliate-Key | Pflicht für card-present-Integrationen inkl. Cloud API; anlegen unter Toolkit → Affiliate Keys mit einer App-ID (z. B. `local.clubtouch3`); wird im Checkout als `affiliate: {app_id, key}` mitgeschickt [8]. |
| Merchant Code | Kurzer Händler-Code (z. B. `MH4H92C7`), im Dashboard sichtbar bzw. per `GET /v0.1/me` abrufbar [12] **[Annahme zum Endpoint, nicht erneut geprüft]**. |
| Öffentlicher HTTPS-Endpunkt | Für den Webhook (`return_url`) ja: „must be a HTTPS url“, „publicly reachable“ [2][3]. Railway-Backend erfüllt das. Ohne Webhook geht es notfalls per Polling der Transactions API [9][19]. |
| Webhook-Sicherheit | **[Fakt]** Für den Cloud-API-Webhook ist keine Signatur dokumentiert; SumUp verlangt generell: „After receiving a webhook call, your application must always verify if the event really took place, by calling a relevant SumUp's API“ [27]. Ein Drittintegrator bestätigt: „SumUp signs nothing“ [19]. → Webhook-URL mit geheimem Pfad-Token + Gegenprüfung per Transactions API. Wiederholversuche sind nur für Online-Checkouts dokumentiert (4 Retries: 1 min, 5 min, 20 min, 2 h) [27]; **[Annahme]** für den Solo-Webhook nicht verlassen, eigenes Polling als Fallback. |
| Sandbox / Test | Sandbox-Händlerkonto im Dashboard („Sandboxes“ in den Developer Settings), eigene Merchant-ID, kein echtes Geld; Beträge mit Wert `11` schlagen absichtlich fehl [16]. **Virtual Solo** unter `https://virtual-solo.sumup.com` simuliert den Reader inkl. Pairing und Checkout, ohne Karte, PIN wird automatisch bestätigt, keine Offline-Transaktionen [2][16]. |
| Gebühren (Deutschland) | Kartenterminal: **1,39 %** je Zahlung im Standardtarif ohne Grundgebühr; mit „Zahlungen Plus“ (19 €/Monat oder 199 €/Jahr) 0,79 % für inländische Karten (AMEX/Firmenkarten bleiben 1,39 %); Fernzahlungen 2,50 % bzw. 0,99 %; Rückerstattungen kostenlos [15][28]. Zahlungen mit SumUp-Karte 0 % [15]. Keine gesonderten API-Kosten dokumentiert [7][10]. |
| Auszahlung | Eigenes Bankkonto: 1–2 Werktage; SumUp-Geschäftskonto: bis 7 Uhr am Folgetag, auch am Wochenende [15][28]. Gebühr wird vor Auszahlung abgezogen; die Payouts API weist `amount` und `fee` je Datensatz aus [17]. |
| Refund per API | Ja, voll oder teilweise, s. Tabelle oben [12]. |
| Trinkgeld | Per `tip_rates` am Terminal abfragbar; `tip_amount` kommt in der Transaktion zurück [3][9]. |

---

## 3. Integrationsskizze für ClubTouch3

### 3.1 Ablauf „Karte (SumUp)“ im Verkauf

```
Sales.js                    Backend                                  SumUp / Solo
  │ Zahlungsart "Karte"        │                                          │
  ├─ POST /api/payments/sumup/checkout {items, customerId?} ─────────────►│
  │                            ├─ Warenkorb validieren (Artikel aktiv,    │
  │                            │  Menge > 0, Summe berechnen)             │
  │                            ├─ CardPayment PENDING + cartJson anlegen  │
  │                            ├─ POST …/readers/{id}/checkout ──────────►│ Solo zeigt Betrag,
  │◄─ {cardPaymentId, status}  │◄─ 201 {checkout_id, client_transaction_id}│ wartet auf Karte
  │ Dialog "Karte am Terminal" │                                          │
  │ (Socket-Event + Polling    │◄─ POST /api/payments/sumup/webhook/:token │ Ergebnis
  │  alle 2 s auf GET …/:id)   ├─ Gegenprüfen: GET /v2.1/…/transactions?client_transaction_id
  │                            ├─ SUCCESSFUL → transactionService.createSale(cart, CARD)
  │                            │   CardPayment.transactionId setzen, emit 'cardpayment:update'
  │◄─ status SUCCESSFUL, txId  │   FAILED/CANCELLED → CardPayment schließen, Fehlermeldung
  │ "Abbrechen"-Button ──────► POST /api/payments/sumup/:id/cancel ──────► …/terminate
```

**Empfehlung: Verkauf erst nach Erfolg buchen** (Variante A). Die Transaction-Tabelle bleibt unverändert (kein `PENDING`-Status auf `Transaction`), Lager/Highscore/`sale:new` werden erst bei bestätigter Zahlung berührt, `cancelSale` funktioniert wie bisher. Der Warenkorb wird als Snapshot in `CardPayment.cartJson` gehalten und beim Erfolg an das bestehende `transactionService.createSale` übergeben (idempotent über `CardPayment.transactionId`, DB-Unique). **[Annahme]** Preisänderungen zwischen Checkout und Buchung sind im Clubbetrieb vernachlässigbar; sicherheitshalber wird der beim Checkout berechnete Betrag als `totalAmount` fixiert und mit dem SumUp-`amount` verglichen.

Variante B (Verkauf sofort als „ausstehend“ buchen und bei Fehlschlag stornieren) wäre invasiver: `Transaction` bräuchte ein Statusfeld, Highscore/EÜR/Dashboard müssten `PENDING` überall ausfiltern. Nur sinnvoll, wenn Bons/Positionen schon vor Zahlung sichtbar sein müssen – das ist bei uns nicht der Fall.

### 3.2 Fehlerfälle

| Fall | Verhalten |
|---|---|
| Reader offline / 60-s-Fenster verpasst / anderer Checkout läuft | SumUp lehnt den Checkout ab (4xx) [2] → sofortige Fehlermeldung im Dialog, kein `CardPayment` offen lassen (Status `FAILED`, `failureReason`). Vorab `GET …/readers/{id}/status` prüfen und „Terminal offline“ anzeigen. |
| Kunde bricht am Terminal ab / Karte abgelehnt | Webhook `failed` [2] → `CardPayment.FAILED`, Kasse zeigt Grund, Warenkorb bleibt erhalten, Kassierer kann „Bar“ oder erneut „Karte“ wählen. |
| Kassierer bricht ab | `POST …/:id/cancel` → `terminate`; geht nur solange der Solo auf den Kunden wartet [2]. Wenn `terminate` scheitert (Zahlung bereits autorisiert), Ergebnis abwarten. |
| Kein Webhook nach X s | Eigenes Timeout im Backend (z. B. 120 s, Solo hat zusätzlich eigene Timeouts): Transactions API per `client_transaction_id` abfragen [9][19]; kein Datensatz → `PENDING` bleibt, `terminate` versuchen; nach hartem Timeout Status `TIMEOUT`. |
| Nachzügler | Kommt für einen `TIMEOUT`/`FAILED`-Datensatz später doch `successful` (Webhook oder Abgleich), wird der Verkauf nachgebucht bzw. – falls der Kassierer inzwischen bar kassiert hat – als „unzugeordnete Kartenzahlung“ markiert und in der Kassenprüfung angezeigt (manuelle Entscheidung: Refund per API oder Zuordnung). |
| Backend-Neustart mit offenen `PENDING` | Beim Start und per Intervall (z. B. alle 60 s) alle `PENDING` älter als 30 s gegen die Transactions API abgleichen. |
| Tablet offline | Kartenzahlung ist **nicht** offline-fähig: Button deaktivieren, wenn `OfflineContext` offline meldet; der Offline-Queue-Mechanismus bleibt Bar/Konto vorbehalten. |
| Webhook-Duplikate / gefälschte Aufrufe | Route `POST /api/payments/sumup/webhook/:token` ohne JWT, aber mit Zufalls-Token aus `SUMUP_WEBHOOK_TOKEN`; Inhalt wird nie geglaubt, sondern immer per Transactions API verifiziert [27]; Verarbeitung idempotent über `CardPayment.status`. |

### 3.3 Storno / Refund

- `cancelSale` für eine `CARD`-Transaktion ruft vorher `POST /v1.0/merchants/{mc}/payments/{sumupTransactionId}/refunds` (Vollbetrag) [12]. Erst bei 2xx wird die verknüpfte `REFUND`-Transaction angelegt (bestehende Logik), `CardPayment.refundedAt` gesetzt.
- 409 „not refundable“ (z. B. bereits erstattet, zu alt, Chargeback) → deutsche Fehlermeldung „Kartenzahlung kann über SumUp nicht mehr erstattet werden – bitte in der SumUp-App prüfen“; der Kassenstorno wird **nicht** blind gebucht.
- **[Fakt]** Der Refund-Endpoint hat keine dokumentierte Idempotenz [19] → nur einmal aufrufen, Ergebnis sofort persistieren, kein automatischer Retry.
- Teilerstattungen (`amount`) erst in einer späteren Stufe; heute storniert ClubTouch3 ohnehin nur ganze Verkäufe.

### 3.4 Tagesabgleich in der Kassenprüfung

- **Kartenumsatz ist kein Bargeld**: `cashCountService` filtert bereits auf `paymentMethod: 'CASH'` [Code: `apps/backend/src/services/cashCountService.js`], `CARD` bleibt automatisch aus der Kassenzählung draußen. In der EÜR (`accountingService.getProfitLoss`) müssen `CARD`-Verkäufe als Einnahme zählen (heute wird nach `CASH` und `ACCOUNT` getrennt gezählt), und in `liquidity` kommt ein neuer Block „Kartenumsatz (SumUp)“ mit Brutto, Gebühren, Nettoauszahlung.
- Abgleichslauf (Button „Mit SumUp abgleichen“ auf dem Tab „Kasse & Bank“, Zeitraum = Geschäftstag-Fenster aus `businessDayWindow()`):
  1. `GET /v2.1/merchants/{mc}/transactions/history?oldest_time&newest_time&statuses=SUCCESSFUL,REFUNDED&payment_types=POS` [9] → Liste der SumUp-Transaktionen.
  2. Je `client_transaction_id` gegen `CardPayment` matchen; Abweichungen in drei Eimern: „bei SumUp, aber nicht in ClubTouch“ (z. B. manuell am Terminal kassiert), „in ClubTouch PENDING/TIMEOUT, bei SumUp erfolgreich“, Betragsdifferenz (Trinkgeld: `tip_amount` gesondert ausweisen).
  3. `GET /v1.0/merchants/{mc}/payouts?start_date&end_date` [17] → `fee` und `amount` je Auszahlung/Abzug für „Bankeingang = Kartenumsatz − Gebühren“, plus `REFUND_DEDUCTION`/`CHARGE_BACK_DEDUCTION`.
- **[Annahme]** Auszahlungsrhythmus (1–2 Werktage bzw. Folgetag beim SumUp-Geschäftskonto [15][28]) bedeutet: der Bankeingang eines Geschäftstags kommt mit Verzug; für den Jahresabschluss zählt der SumUp-Umsatz des Zeitraums als Einnahme, die noch nicht ausgezahlte Summe ist eine Forderung gegen SumUp (`receivables.sumupPending`). Steuerliche Behandlung der Gebühren (Betriebsausgabe) mit dem Kassenprüfer/Steuerberater klären.

### 3.5 Datenmodell und Konfiguration

Prisma (Migration nötig):

```prisma
enum PaymentMethod { CASH  ACCOUNT  INVOICE  TRANSFER  CARD }   // CARD neu

enum CardPaymentStatus { PENDING  SUCCESSFUL  FAILED  CANCELLED  TIMEOUT }

model CardReader {
  id             String   @id @default(uuid())
  sumupReaderId  String   @unique      // 30-stellige Reader-ID von SumUp
  name           String                // "Theke"
  model          String?               // solo | virtual-solo
  active         Boolean  @default(true)
  lastStatus     String?               // ONLINE/OFFLINE + Gerätezustand
  lastSeenAt     DateTime?
  createdAt      DateTime @default(now())
  payments       CardPayment[]
}

model CardPayment {
  id                       String            @id @default(uuid())
  status                   CardPaymentStatus @default(PENDING)
  amount                   Decimal           @db.Decimal(10, 2)   // ohne Trinkgeld, wie berechnet
  tipAmount                Decimal?          @db.Decimal(10, 2)
  currency                 String            @default("EUR")
  cartJson                 Json              // {items:[{articleId, quantity}], customerId?}
  readerId                 String
  reader                   CardReader        @relation(fields: [readerId], references: [id])
  sumupCheckoutId          String?
  sumupClientTransactionId String?           @unique
  sumupTransactionId       String?           @unique   // aus Transactions API, für Refund
  sumupTransactionCode     String?           // für Payout-Abgleich
  failureReason            String?
  transactionId            String?           @unique   // gebuchte SALE-Transaction
  transaction              Transaction?      @relation(fields: [transactionId], references: [id])
  refundedAt               DateTime?
  createdBy                String            // User-ID
  createdAt                DateTime          @default(now())
  finishedAt               DateTime?
  @@index([status, createdAt])
}
```

Optional für die Zukunft: `AccountTopUp.method` (heute `CASH | TRANSFER`, Validierung `isIn(['CASH','TRANSFER'])` in `apps/backend/src/middleware/validation.js`) um `CARD` erweitern, damit Guthaben per Karte aufgeladen werden kann – gleicher Checkout-Flow, anderes Ziel.

Konfiguration: Secrets in Env (`SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE`, `SUMUP_AFFILIATE_KEY`, `SUMUP_APP_ID`, `SUMUP_WEBHOOK_TOKEN`, `SUMUP_BASE_URL` für Sandbox/Live), Betriebseinstellungen in `SystemSetting` (`sumup.enabled`, `sumup.defaultReaderId`, `sumup.tipRates`, `sumup.timeoutSeconds`). `PUBLIC_BASE_URL` existiert bereits und liefert die `return_url`.

Berührte Stellen im Code (Vorabinventur): `transactionService.createSale` (nimmt `paymentMethod: 'CARD'` schon strukturell entgegen; 10-€-Überziehung gilt nur für `ACCOUNT`), `validation.js` (`isIn(['CASH','ACCOUNT'])` an zwei Stellen), `accountingService.getProfitLoss` (Einnahmen je Zahlungsart), `exportService` (Label „Bar-Zahlung“ bei `CASH`, Tagesabschluss), Frontend `pages/Sales.js` (`bookingTarget.type`, aktuell `CASH | OWNER | CUSTOMER`), `pages/ProfitLoss.js` (neuer Block Karte), `pages/CashCount.js` (Hinweis „Kartenumsatz nicht in der Kasse“), neue Admin-Seite/Dialog „Terminal koppeln“ (Pairing-Code eingeben, Status anzeigen).

Neue Backend-Dateien: `routes/payments.js`, `controllers/paymentController.js`, `services/sumupService.js` (HTTP-Client, Checkout, Terminate, Transactions, Payouts, Refund), `services/cardPaymentService.js` (Zustandsmaschine, Abgleich, Finalisierung → `createSale`), Webhook-Route ohne `authenticate`, Socket-Event `cardpayment:update` in `utils/websocket.js`.

---

## 4. Aufwandsschätzung und Risiken

### 4.1 Stufen

| Stufe | Inhalt | Aufwand (Annahme) |
|---|---|---|
| **(a) Minimal: Zahlungsart „Karte“ ohne Terminal-Anbindung** | `PaymentMethod.CARD` + Migration, Validierung, Button „Karte“ in `Sales.js` (Terminal wird manuell bedient, Kassierer bestätigt „bezahlt“), EÜR/Exports/Dashboard weisen Karte getrennt aus, Kassenzählung ignoriert Karte, Hinweistext. Kein SumUp-Konto-Zugriff nötig. | 1–2 Tage |
| **(b) Reader-API-Anbindung** | Pairing-Verwaltung, `sumupService`, Checkout-Flow mit Dialog, Webhook + Socket + Polling, Timeout/Terminate, Abgleich `PENDING` beim Start, Sandbox-Test mit Virtual Solo, Test mit echtem Solo im Clubraum, Railway-Env. | 5–8 Tage (davon ca. 1 Tag Feldtest) |
| **(c) Refund + automatischer Abgleich** | Refund beim Storno inkl. 409-Behandlung, Abgleichslauf Transactions + Payouts, neuer Block in der Kassenprüfung (Brutto/Gebühr/Netto, Differenzenliste), Übernahme in `YearEndReport.detailsJson`/EÜR-PDF, „unzugeordnete Kartenzahlungen“. | 3–5 Tage |

Voraussetzung für (b)/(c) ist ein **Solo**; mit Solo Lite/Air bleibt es bei (a).

### 4.2 Risiken und Stolpersteine

- **Modellfrage zuerst klären.** Nur Solo (und Solo mit Drucker) hat WLAN/SIM und Cloud-API-Unterstützung [4][5][6]. Vor jeder Umsetzung: Typenschild/App prüfen.
- **Exklusivbetrieb:** Für die Cloud API muss der Solo aus der SumUp-App ausgeloggt sein [2]. Während er an ClubTouch3 gekoppelt ist, kann niemand „schnell manuell“ am Terminal kassieren, ohne ihn neu einzuloggen; danach ist eine erneute Kopplung nötig **[Annahme aus dem Pairing-Ablauf]**. Das muss im Team bekannt sein.
- **Ein Checkout gleichzeitig, 60-Sekunden-Regel** [2]: Bei zwei Kassen-Tablets braucht es eine Sperre pro Reader im Backend (Unique auf `PENDING` je `readerId`) und eine klare Anzeige „Terminal belegt“.
- **WLAN im Clubraum:** Reader und Tablets hängen am selben Netz, der Reader braucht Internet, nicht nur LAN; SumUp empfiehlt den Solo für Cloud-API-Betrieb dauerhaft am Strom [2]. Fällt das WLAN aus, greift die SIM des Solo, die Tablets aber nicht → Kartenzahlung offline sperren (s. 3.2).
- **Lokale Entwicklung:** Webhooks erreichen `localhost` nicht [2][3]. Entwickeln mit Virtual Solo + Sandbox-Key und reinem Polling; für Webhook-Tests ein Tunnel (z. B. cloudflared/ngrok) oder die Railway-Preview-Umgebung. Die Webhook-Verarbeitung so bauen, dass Polling allein funktional gleichwertig ist.
- **Webhook-Vertrauen:** Keine Signatur dokumentiert [19][27] → immer per Transactions API verifizieren; Retries nicht garantiert → eigener Reconcile-Job.
- **Trinkgeld:** Bei aktivierten `tip_rates` weicht der SumUp-Betrag vom Kassenbetrag ab; `tip_amount` separat speichern und im Abgleich ausweisen [3][9]. Steuerliche Behandlung von Trinkgeld an Ehrenamtliche/Personal vorab mit dem Kassenprüfer klären **[Annahme: kein Rechtsrat]**.
- **Gebühren im Abgleich:** 1,39 % werden vor Auszahlung abgezogen [15][28]; ohne Payouts-Abgleich passt der Bankeingang nie zum Kartenumsatz. Deshalb gehört mindestens ein einfacher Gebühren-Ausweis schon in Stufe (a)/(b) als manuelles Feld oder Schätzung.
- **Node-SDK pre-1.0** [26]: Entweder direkt REST mit `fetch` (kein zusätzliches Paket) oder Version pinnen.
- **Kassensicherungsverordnung / TSE – kurze Einordnung, keine Rechtsberatung:**
  - **[Fakt]** In Deutschland gibt es keine allgemeine Registrierkassenpflicht; Vereine dürfen weiterhin eine offene Ladenkasse mit täglichem Kassenbericht führen. Wer aber ein **elektronisches Aufzeichnungssystem** einsetzt, muss es mit einer zertifizierten TSE ausstatten, unterliegt der Belegausgabepflicht und seit 2025 der Meldepflicht beim Finanzamt (§ 146a AO) [20][29].
  - **[Annahme]** ClubTouch3 ist ein elektronisches Kassensystem und damit von dieser Frage **unabhängig von SumUp** betroffen; eine SumUp-Anbindung ändert daran nichts, weder verschärfend noch entlastend. Das SumUp-eigene „Kassensystem“ (nicht das Terminal) bringt eine TSE mit, die Cloud API dagegen liefert ClubTouch3 keine TSE.
  - **[Annahme]** Vereinsbetreiber sollte mit Kassenprüfer/Steuerberater klären, ob für den Zweckbetrieb/wirtschaftlichen Geschäftsbetrieb des Vereins eine TSE-Nachrüstung (Cloud-TSE-Anbieter) oder eine andere Dokumentation ausreicht. Das ist ein eigener Backlog-Punkt und keine Voraussetzung für die Kartenanbindung.

### 4.3 Empfehlung für die Reihenfolge

1. Modell des vorhandenen Terminals prüfen und Betreiber-Entscheidung zu Trinkgeld/Exklusivbetrieb einholen.
2. Stufe (a) umsetzen – sie ist in jedem Fall nötig, sobald Kartenzahlungen an der Theke vorkommen, damit EÜR und Kassenzählung stimmen.
3. Sandbox-Konto + Virtual Solo anlegen, Stufe (b) auf einem Feature-Branch bauen, gegen die Railway-Preview testen, dann Feldtest im Clubraum.
4. Stufe (c) nach den ersten Wochen Echtbetrieb, wenn klar ist, wie der Kassenprüfer die Gebühren sehen will.

---

## Quellen (abgerufen am 29.09.2026)

1. SumUp Developer – In-Person Payments (Übersicht Cloud API / SDKs / Payment Switch, Reader-Liste): https://developer.sumup.com/terminal-payments
2. SumUp Developer – Cloud API Guide (Pairing, Checkout, `return_url`, Webhook-Payload, Terminate, 60-s-Fenster, Virtual Solo, Logout-Pflicht): https://developer.sumup.com/terminal-payments/cloud-api
3. SumUp Developer – API Reference Readers (Endpunkte, Felder, Scopes, Reader-Statuswerte, `device.model` solo/virtual-solo): https://developer.sumup.com/api/readers und https://developer.sumup.com/api/readers/create-checkout
4. SumUp Developer – Reader Solo Lite (nur SDK/Payment Switch, Bluetooth): https://developer.sumup.com/terminal-payments/readers/solo-lite/
5. SumUp Developer – Reader Air (nur SDK/Payment Switch, Bluetooth): https://developer.sumup.com/terminal-payments/readers/air/
6. SumUp Developer – Reader Solo (Cloud API, WLAN/SIM/Bluetooth, Drucker): https://developer.sumup.com/terminal-payments/readers/solo/
7. SumUp Developer – API Keys (Dashboard-Pfad, `sup_sk_`, Bearer-Header): https://developer.sumup.com/tools/authorization/api-keys/
8. SumUp Developer – Affiliate Keys (Pflicht für Cloud API, Dashboard-Pfad, `affiliate {app_id, key}`): https://developer.sumup.com/tools/authorization/affiliate-keys/
9. SumUp Developer – API Reference Transactions (Get by `client_transaction_id`, History-Filter, Statuswerte, `tip_amount`, `payout_date`): https://developer.sumup.com/api/transactions/get
10. SumUp Developer – Authorization (API-Key vs. OAuth): https://developer.sumup.com/tools/authorization/authorization
11. SumUp Developer – OAuth 2.0 (Scopes, restricted scopes): https://developer.sumup.com/tools/authorization/oauth
12. SumUp Developer – API Reference Refunds (`POST /v1.0/merchants/{merchant_code}/payments/{transaction_id}/refunds`, Scopes, 409): https://developer.sumup.com/api/transactions/refund
13. SumUp Developer – Online Payments (Hosted Checkout, Widget, Checkouts API): https://developer.sumup.com/online-payments
14. SumUp Developer – Payment Switch (Legacy-Hinweis, URL-Schema, Android-Parameter): https://developer.sumup.com/terminal-payments/payment-switch/ und https://developer.sumup.com/terminal-payments/payment-switch/android/
15. SumUp – Preise Deutschland (1,39 % Kartenterminal, 0 % SumUp-Karte, Zahlungen Plus 19 €/Monat, Auszahlung bis 7 Uhr auf SumUp-Geschäftskonto): https://www.sumup.com/de-de/preise/
16. SumUp Developer – Quickstart In-Person Payments und FAQ (Sandbox-Händlerkonto in den Developer Settings, Betrag 11 schlägt fehl, Virtual Solo mit Sandbox): https://developer.sumup.com/terminal-payments/quickstart/ und https://developer.sumup.com/help
17. SumUp Developer – API Reference Payouts (`GET /v1.0/merchants/{merchant_code}/payouts`, `fee`, `transaction_code`, Typen): https://developer.sumup.com/api/payouts/list
18. Web-Suche zu „SumUp Solo und Drucker“ (Solo mit Bondrucker-Dock, WLAN + integrierte SIM, Preis-Größenordnung 85–109 €; Sekundärquellen/Händlerseiten, Preise ohne Gewähr), u. a. https://www.sumup.com/de-de/solo-lite-kartenterminal/ und Händlerangaben aus der Suche
19. wcpos/roadmap Issue #174 – Erfahrungsbericht Drittintegrator zur Solo Cloud API (Polling per `client_transaction_id`, „SumUp signs nothing“, Terminate asynchron, Refund ohne Idempotenz): https://github.com/wcpos/roadmap/issues/174
20. Web-Suche KassenSichV/Vereine (vereinsknowhow.de, vereinswelt.de; Zusammenfassung: keine Registrierkassenpflicht, offene Ladenkasse zulässig, TSE + Belegausgabepflicht bei elektronischer Kasse, Meldepflicht seit 2025) – Sekundärquellen, keine Einzel-URL gesichert
21. SumUp Developer – Solo-Seite/Cloud-API-Beschreibung „POS running on any platform … Web-based“: https://developer.sumup.com/terminal-payments/readers/solo
22. SumUp Developer – Reader Go (Cloud API, nur AU/MX/CA): https://developer.sumup.com/terminal-payments/readers/go/
23. SumUp Developer – Readers-Übersicht (Einsatzzwecke Solo/Solo Lite/Tap to Pay/Go/Air/3G/PIN+): https://developer.sumup.com/terminal-payments/readers/
24. SumUp Developer – Changelog (Cloud API Reader-Status 22.12.2025, TypeScript-SDK 22.06.2025): https://developer.sumup.com/changelog
25. npm `@sumup/sdk` / SumUp Developer Node.js SDK: https://www.npmjs.com/package/@sumup/sdk und https://developer.sumup.com/online-payments/sdks/nodejs
26. GitHub sumup/sumup-ts (Node ≥ 18, CJS+ESM, Apache-2.0, pre-v1, Beispiel card-reader-checkout): https://github.com/sumup/sumup-ts
27. SumUp Developer – Webhooks Online Payments (nur `return_url`, Retry-Plan 1/5/20 min/2 h, „always verify … by calling a relevant SumUp's API“): https://developer.sumup.com/online-payments/webhooks
28. gastrorocket.de – SumUp Gebühren 2026 (1,39 % / 0,79 % Plus, 2,50 % / 0,99 % Fernzahlung, Erstattungen kostenlos, Auszahlung nächster Werktag; Sekundärquelle, Stand April 2026): https://gastrorocket.de/ratgeber/ausstattung/sumup-gebuehren
29. Bundesfinanzministerium – FAQ zur steuerlichen Behandlung von Kassen (§ 146a AO, TSE, Belegausgabe, Meldepflicht; Seite am Abrufdatum durch Bot-Schutz nicht maschinell lesbar, Inhalt aus Sekundärquellen [20]): https://www.bundesfinanzministerium.de/Content/DE/FAQ/2020-02-18-steuerliche-behandlung-von-kassen-faq.html
