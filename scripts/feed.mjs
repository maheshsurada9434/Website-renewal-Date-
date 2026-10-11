// Builds data/feed.json: the best domains that are dropping (being deleted) today and
// expired domains whose auctions end in the next day and a half.
// Sources (free public files): SnapNames deleting list, GoDaddy Auctions expired-domain inventory.
// Run: node scripts/feed.mjs   (needs curl and unzip, both present on GitHub runners)
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const TMP = '/tmp/radar-feed';
mkdirSync(TMP, { recursive: true });
const KEEP = 200;
const now = Date.now();
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

function download(url, file) {
  try { execFileSync('curl', ['-sSL', '--fail', '-A', UA, '-m', '600', '-o', file, url], { stdio: 'inherit' }); return existsSync(file); }
  catch (e) { console.log('Download failed:', url); return false; }
}
// Stream the text inside a zip line by line, without loading it all into memory.
function streamZip(file, onChunk) {
  return new Promise((resolve, reject) => {
    const p = spawn('unzip', ['-p', file]);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', onChunk);
    p.on('close', resolve); p.on('error', reject);
  });
}
const num = v => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return isFinite(n) ? n : 0; };
const log10 = x => Math.log10(Math.max(0, x) + 1);
const TLD_PTS = { com: 12, in: 8, 'co.in': 7, net: 6, org: 6, io: 6, ai: 7, co: 5, 'co.uk': 5, uk: 4, us: 3, info: 1, biz: 1, cc: 1 };
function nameScore(domain) {
  const [sld, ...rest] = domain.split('.'); const tld = rest.join('.');
  let s = TLD_PTS[tld] ?? 2;
  s += sld.length <= 5 ? 14 : sld.length <= 8 ? 10 : sld.length <= 12 ? 5 : sld.length <= 16 ? 1 : -4;
  if (/-/.test(sld)) s -= 8;
  if (/\d/.test(sld)) s -= 6;
  if (/^[a-z]+$/.test(sld) && /[aeiou]/.test(sld) && !/[^aeiouy]{4}/.test(sld)) s += 5;
  return { s, tld, sld };
}
const clamp = n => Math.max(0, Math.min(100, Math.round(n)));

/* ---------- 1. Dropping today: SnapNames deleting list ---------- */
async function dropping() {
  const f = `${TMP}/deleting.zip`;
  if (!download('https://www.snapnames.com/file_dl.sn?file=deletinglist.zip', f)) return { items: [], total: 0, byDate: {} };
  // "Join By Date (ET)" is the deadline to backorder, i.e. roughly when the domain is released.
  const etToUtc = s => { const m = /(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)/.exec(s); if (!m) return ''; return new Date(Date.UTC(+m[3], m[1] - 1, +m[2], +m[4] + 4, +m[5])).toISOString(); };
  let buf = '', header = null, total = 0; const byDate = {}; const best = [];
  const handle = line => {
    const c = line.split('\t').map(x => x.trim());
    if (!header) { header = c; return; }
    if (c.length < 13 || !c[0]) return;
    const domain = c[0].toLowerCase(); const when = etToUtc(c[2]); if (!when) return;
    total++; const day = when.slice(0, 10); byDate[day] = (byDate[day] || 0) + 1;
    const hrs = (Date.parse(when) - now) / 36e5;
    if (hrs < -12 || hrs > 36) return; // dropping today / within ~a day
    const bidders = num(c[4]), bid = num(c[1]), words = c[8], wc = num(c[9]), cats = c[10];
    const ns = nameScore(domain);
    // Real dictionary words make a name worth having; random letter strings rarely are.
    const fullWords = wc >= 1 && words.replace(/[^a-z]/gi, '').toLowerCase() === ns.sld.replace(/[^a-z]/g, '');
    let s = 10 + ns.s + Math.min(35, bidders * 8) + Math.min(10, log10(bid) * 4) + (fullWords ? (wc <= 2 ? 24 : 12) : wc ? 4 : -10) + (cats ? 6 : 0);
    const item = { domain, tld: ns.tld, when, bidders, bid, words, categories: cats.split(/\s*,\s*/).filter(Boolean).slice(0, 3).join(', '), score: clamp(s) };
    best.push(item);
    if (best.length > KEEP * 6) { best.sort((a, b) => b.score - a.score); best.length = KEEP * 3; }
  };
  await streamZip(f, chunk => { buf += chunk; let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } });
  if (buf) handle(buf);
  best.sort((a, b) => b.score - a.score || a.domain.length - b.domain.length);
  return { items: best.slice(0, KEEP), total, byDate };
}

/* ---------- 2. Expired: GoDaddy expired-domain auctions ending soon ---------- */
async function expired() {
  const f = `${TMP}/expiring.zip`;
  if (!download('https://inventory.auctions.godaddy.com/all_expiring_auctions.json.zip', f)) return { items: [], total: 0, endingSoon: 0 };
  let buf = '', total = 0, endingSoon = 0; const best = [];
  const handle = o => {
    total++;
    if (o.isAdult) return;
    const end = Date.parse(o.auctionEndTime); if (!end) return;
    const hrs = (end - now) / 36e5;
    if (hrs < 0 || hrs > 36) return;
    endingSoon++;
    const domain = String(o.domainName || '').toLowerCase(); if (!domain) return;
    const ns = nameScore(domain);
    const val = num(o.valuation), bids = num(o.numberOfBids), age = num(o.domainAge), refd = num(o.majesticReferringDomains) || num(o.semrushReferringDomains);
    let s = ns.s + Math.min(28, log10(val) * 9) + Math.min(15, bids * 3) + Math.min(12, age * 0.8) + Math.min(12, log10(refd) * 5) + Math.min(6, log10(num(o.semrushSearchVolume)) * 2);
    best.push({ domain, tld: ns.tld, when: o.auctionEndTime, type: o.auctionType, price: o.price, bids, age, valuation: o.valuation, backlinks: num(o.majesticBacklinks), refDomains: refd,
      pageviews: num(o.pageviews), traffic: num(o.semrushSearchVolume), link: o.link, score: clamp(s) });
    if (best.length > KEEP * 6) { best.sort((a, b) => b.score - a.score); best.length = KEEP * 3; }
  };
  await streamZip(f, chunk => {
    buf += chunk;
    const re = /\{[^{}]*\}/g; let m, last = 0;
    while ((m = re.exec(buf))) { last = re.lastIndex; if (m[0].includes('"domainName"')) { try { handle(JSON.parse(m[0])); } catch (e) {} } }
    buf = buf.slice(last);
    if (buf.length > 1e6) buf = buf.slice(-2e5);
  });
  best.sort((a, b) => b.score - a.score || a.domain.length - b.domain.length);
  return { items: best.slice(0, KEEP), total, endingSoon };
}

const [d, e] = await Promise.all([dropping(), expired()]);
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const out = { generated: new Date().toISOString(),
  dropping: { source: 'SnapNames deleting list', total: d.total, byDate: d.byDate, items: d.items },
  expired: { source: 'GoDaddy Auctions expired domains', total: e.total, endingSoon: e.endingSoon, items: e.items } };
writeFileSync(new URL('../data/feed.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`Dropping: ${d.total} on the list, kept ${d.items.length}. Expired auctions: ${e.total}, ending within 36h: ${e.endingSoon}, kept ${e.items.length}.`);
console.log('Top dropping:', d.items.slice(0, 8).map(x => `${x.domain}(${x.score})`).join(' '));
console.log('Top expired:', e.items.slice(0, 8).map(x => `${x.domain}(${x.score})`).join(' '));
