// Daily scan: looks up every domain in domains.txt and writes data/domains.json.
// Run locally with: node scripts/scan.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const RDAP = require('../rdap.js');

const list = RDAP.parseList(readFileSync(new URL('../domains.txt', import.meta.url), 'utf8'));
console.log(`Checking ${list.length} domains…`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let i = 0;
async function worker() {
  while (i < list.length) {
    const d = list[i++];
    let r = await RDAP.lookup(d, { timeout: 20000 });
    if (r.error && /rate-limit|too long|reach/.test(r.error)) { await sleep(5000); r = await RDAP.lookup(d, { timeout: 20000 }); }
    if (r.found !== false && !r.error) r.quality = RDAP.quality(d, r).score;
    results.push(r);
    console.log(`${d.padEnd(32)} ${r.error ? 'ERROR ' + r.error : r.found === false ? 'NOT REGISTERED' : `${r.phase.padEnd(13)} expires ${r.expires || '?'} (${r.daysLeft ?? '?'} days)`}`);
    await sleep(700);
  }
}
await Promise.all([worker(), worker(), worker()]);
const order = { pendingDelete: 0, redemption: 1, grace: 2, available: 3, soon: 4, watch: 5, active: 6, unknown: 7 };
results.sort((a, b) => (order[a.phase] ?? 9) - (order[b.phase] ?? 9) || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || a.domain.localeCompare(b.domain));
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/domains.json', import.meta.url), JSON.stringify({ generated: new Date().toISOString(), count: results.length, results }, null, 1) + '\n');
const soon = results.filter(r => ['pendingDelete', 'redemption', 'grace', 'soon', 'available'].includes(r.phase));
console.log(`\nDone. ${soon.length} need attention.`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map(r => `| ${r.domain} | ${r.error ? '⚠️ ' + r.error : r.phase} | ${r.expires ? r.expires.slice(0, 10) : '—'} | ${r.daysLeft ?? '—'} |`).join('\n');
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## Renewal Radar scan\n\n| Domain | Phase | Expires | Days left |\n|---|---|---|---|\n${rows}\n`, { flag: 'a' });
}
