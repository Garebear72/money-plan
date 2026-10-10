# Money Plan

A small, installable budgeting app (PWA) that runs entirely on your phone.

- **Private by design.** The app contains no financial data. You load your own plan file on your device, and it is saved only in that browser's local storage. The page's Content-Security-Policy blocks all network requests (`connect-src 'none'`). There are no third-party scripts, fonts or analytics.
- **Works offline.** A service worker caches the app's own files. It never sees or stores your data.
- **Everything is editable** after import: paychecks, savings moves, rent and extras, bills, debts, balances, the partner log and purchases.

## Using it

1. Open the site in Chrome on Android and choose **Add to Home screen** / **Install app**.
2. On first launch, choose your plan file or paste its JSON, tap **Validate**, check the summary, then tap **Import**.
3. Log purchases by hand, with one tap for ones you repeat, or import them in bulk from your bank (see below).
4. Back up any time from **Settings → Export plan file** (or **Copy as text**). Importing that file restores everything exactly.

## Importing purchases from your bank

Today → **Import purchases from your bank** reads a bank activity CSV on the device. Nothing is uploaded. It works with Chase checking and card exports, and with most banks whose file has date, description and amount (or debit/credit) columns. Each money-out row is shown with a cleaned-up name and a guessed category. It's left unticked if it matches a bill, a purchase you've already logged (same amount within 3 days), a transfer or Zelle payment, or a cash withdrawal. Re-importing an overlapping date range doesn't create duplicates.

## Paychecks

On payday, the Bills tab asks one thing: **what you got paid**. Each paycheck stands alone. Bills due before the next payday come out first. Anything you move to savings, and anything you pay your partner, during that pay period comes out next. The rest is your spending money, and Today's weekly limit is its share for the week. A week that straddles a payday blends both paychecks.

The only time a paycheck holds money back is when the next one can't cover its own bills; then it keeps the gap. Upcoming paychecks are expected to match your latest one, and are labelled "expected" until you enter them.

**Savings** has its own card on the Bills tab. Log money as you move it in or out, whenever that happens. The balance is your Settings balance plus every move logged after its date.

**Where each paycheck went** shows one bar per paycheck: bills, partner payments, savings, what you spent, and what's not spent. Tap one for the amounts and spending by category.

## Plan file format

See [`sample-plan.json`](sample-plan.json) for a complete example. All numbers in it are made up.

| Key | Contents |
| --- | --- |
| `app`, `version` | `"money-plan"`, `1` |
| `settings` | `weekStartsOn`, `warnBelow` (warn if projected checking drops below this), `paycheck {amount, knownPayday, everyDays}` (your latest take-home pay, which upcoming paychecks are expected to match, and the schedule), `rent {amount, dueDay, paidInHalvesOnLastTwoPaydaysBeforeDue, extras[{dueMonth, amount, note}]}`, `checking {balance, asOf}`, `savings {balance, asOf}`, `partner {label, monthlyPayment}`, `holidays[]` |
| `bills[]` | `name`, `amount`, `day`, `end` (date or `null`), `kind` (`subscription`, `debt`, `insurance` or `other`), `shiftToBusinessDay` (optional), `active` |
| `debts[]` | `name`, `billName` (links to a bill), `balance`, `balanceAsOf`, `paymentsLeft`, `apr` (0.2 = 20%), `projectedPayoff`, `projectedPayoffWithExtra` (both optional, `"YYYY-MM"`), `note` |
| `partnerLedger[]` | `type` (`charge` or `payment`), `amount`, `date`, `note` |
| `purchases[]` | `amount`, `note`, `category`, `date` |
| `paychecks[]` (optional) | `date` (the scheduled payday), `amount` received |
| `savingsLog[]` (optional) | `type` (`deposit` or `withdrawal`), `amount`, `date`, `note` |

Dates are `YYYY-MM-DD`. Unknown fields are ignored (including `weeklyLimit` and `savingsPerPayday` from older files; an older paycheck's `movedToSavings` becomes a savings entry), missing optional fields get defaults, and mistakes are reported in plain language with the item and field named.

How the schedule works:

- **Paydays** repeat every `everyDays` from `knownPayday`.
- **Bills** fall on `day` each month (clamped to the month's last day). If `shiftToBusinessDay` is set, they move past weekends and `holidays`. They stop after `end`.
- **Rent** is due on `dueDay`. With halves on, it's paid in two halves on the last two paydays before the due date. Any `extras` for that due month are added.
- **Debts** count payments left from the linked bill's `end` date. If the bill has no end date, they count down `paymentsLeft` from `balanceAsOf` as payments go out.

## Never commit real data

`.gitignore` excludes `my_plan.json`, any `money-plan-backup*.json` export, and the `private/` folder. Keep your real plan file out of this repository.

## Development

```bash
npm install
npx playwright install chromium
npm test
```

`npm run serve` serves the app at `http://127.0.0.1:8080/money-plan/`, the same sub-path layout as GitHub Pages. When you change any app file, bump `VERSION` in `sw.js` so installed copies update.

Fonts: Bricolage Grotesque, Instrument Sans and IBM Plex Mono, self-hosted under the SIL Open Font License (see `fonts/`).
