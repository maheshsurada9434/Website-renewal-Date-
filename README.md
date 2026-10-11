<p align="center"><img src="icons/icon-192.png" width="88" alt=""></p>
<h1 align="center">Renewal Radar</h1>
<p align="center"><b>Find any website's domain renewal date and time, and spot expiring domains worth buying.</b></p>
<p align="center"><a href="https://maheshsurada9434.github.io/Website-renewal-Date-/"><b>▶ Open Renewal Radar</b></a></p>

## What it does

- **Renewal date and time** of any website. You can paste a link, a domain or many at once. It shows the time in your time zone with a countdown.
- **Stage of the domain**:

  | Stage | What it means |
  |---|---|
  | Active | Paid up |
  | Expiring soon | Renewal is due within 30 days |
  | Expired (grace) | The owner can still renew at the normal price |
  | Redemption | The owner can still recover it, for a fee |
  | Pending delete | It is about to be released |
  | Not registered | It is free to buy |

- **Estimated drop date** for expired domains (around 75–80 days after expiry).
- **Registrar, registration date and age, last change, DNS/hosting** (for example Cloudflare, Hostinger or GoDaddy), and status locks.
- **Buyer's quick check** out of 10, based on length, ending, hyphens or numbers, age and how easy the name is to say.
- **Watchlist** saved on your phone:
  - filters: needs attention, 30 days or less, 90 days or less, expired, available and good names
  - refresh all, and CSV export for Excel
- **Calendar reminder** (.ics) with alerts 30 and 7 days before renewal.
- **Heads-up message** to a site owner whose domain is about to expire. You can use it to offer a renewal-management service.
- **Daily scan** runs on GitHub every morning at about 7:45 AM IST and checks every domain in [`domains.txt`](domains.txt). Results appear in the *Daily scan* tab and in each run's summary.
- Installs like an app on your phone (Add to Home Screen) and works on iPhone and Android.

## Add domains to the daily scan

Edit [`domains.txt`](domains.txt) on GitHub and add one domain per line. The scan runs straight away when the file changes, and again every morning.

## Where the data comes from

Lookups use **RDAP**, the official registry service that replaced WHOIS. It is free, needs no account, and the browser asks the registry directly. A few country endings don't publish RDAP yet; for those, the app links to ICANN's lookup.

## A note on reselling domains

Registering a company's name or brand in order to sell it back to them is "bad-faith registration" under the domain dispute rules (UDRP, and INDRP for `.in`). The owner can take the domain back. Stick to generic names (words, places, topics), list them on marketplaces such as Sedo, Afternic or Dan.com, or offer owners a paid renewal-reminder service.

## Files

```
index.html          the app
rdap.js             lookup and parsing (shared by the app and the scan)
domains.txt         your daily-scan list
scripts/scan.mjs    the daily scan (Node 18+, no dependencies)
data/domains.json   latest scan results (updated automatically)
```

Made by **Mahesh Surada**.
