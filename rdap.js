/*
 * Renewal Radar: domain lookup through RDAP, the official registry data service
 * that replaced WHOIS. Shared by the web app (browser) and the daily scan (Node).
 * By Mahesh Surada.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RDAP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
  const FALLBACK = 'https://rdap.org/';
  const DAY = 86400000;

  // Second-level suffixes where the registrable domain has three labels.
  const SLD = new Set(('co.in net.in org.in gen.in firm.in ind.in ac.in edu.in res.in gov.in nic.in mil.in ' +
    'co.uk org.uk me.uk ltd.uk plc.uk net.uk ac.uk gov.uk com.au net.au org.au edu.au gov.au ' +
    'co.nz org.nz net.nz co.za org.za com.br net.br org.br com.sg com.my com.pk com.bd com.np com.lk ' +
    'co.jp ne.jp or.jp com.cn net.cn org.cn com.hk com.tw co.kr com.mx com.ar com.tr com.sa ae.org co.id').split(' '));

  /** Turn anything a person pastes (URL, email, "www.x.com/page") into a registrable domain. */
  function normalize(input) {
    let s = String(input || '').trim().toLowerCase();
    if (!s) return '';
    s = s.replace(/^[a-z]+:\/\//, '').replace(/^[^@/]*@/, '').split(/[/?#:\s]/)[0].replace(/\.+$/, '');
    try { s = new URL('http://' + s).hostname; } catch (e) { return ''; }
    const parts = s.split('.').filter(Boolean);
    if (parts.length < 2) return '';
    const last2 = parts.slice(-2).join('.');
    const keep = SLD.has(last2) && parts.length >= 3 ? 3 : 2;
    return parts.slice(-keep).join('.');
  }
  function parseList(text) {
    const seen = new Set(), out = [];
    String(text || '').split(/[\s,;]+/).forEach(t => { if (!t || t.startsWith('#')) return; const d = normalize(t); if (d && !seen.has(d)) { seen.add(d); out.push(d); } });
    return out;
  }

  let bootstrap = null;
  // The site keeps a copy of IANA's registry list (data/dns.json, refreshed by the daily scan).
  const LOCAL_BOOTSTRAP = typeof location !== 'undefined' && /^https?:/.test(location.protocol) ? 'data/dns.json' : '';
  async function servers(fetchFn) {
    if (bootstrap) return bootstrap;
    try {
      let j = null;
      for (const u of [LOCAL_BOOTSTRAP, BOOTSTRAP_URL].filter(Boolean)) {
        try { const r = await fetchFn(u); if (r.ok) { j = await r.json(); if (j && j.services) break; } } catch (e) {}
      }
      if (!j || !j.services) throw new Error('bootstrap');
      const map = {};
      (j.services || []).forEach(([tlds, urls]) => {
        const url = (urls.find(u => u.startsWith('https:')) || urls[0] || '').replace(/\/?$/, '/');
        tlds.forEach(t => { map[t.toLowerCase()] = url; });
      });
      bootstrap = map;
    } catch (e) { bootstrap = {}; }
    return bootstrap;
  }

  function vcardName(entity) {
    const v = entity && entity.vcardArray && entity.vcardArray[1];
    if (!Array.isArray(v)) return '';
    const fn = v.find(x => x[0] === 'fn') || v.find(x => x[0] === 'org');
    return fn ? String(Array.isArray(fn[3]) ? fn[3].join(' ') : fn[3]) : '';
  }
  function findRegistrar(entities) {
    for (const e of entities || []) {
      if ((e.roles || []).includes('registrar')) {
        const name = vcardName(e) || (e.publicIds && e.publicIds[0] && ('IANA ' + e.publicIds[0].identifier)) || e.handle || '';
        const ianaId = (e.publicIds || []).find(p => /iana/i.test(p.type || ''));
        const abuse = (e.entities || []).find(x => (x.roles || []).includes('abuse'));
        let abuseEmail = '';
        if (abuse && abuse.vcardArray) { const em = abuse.vcardArray[1].find(x => x[0] === 'email'); if (em) abuseEmail = em[3]; }
        const url = (e.links || []).find(l => l.rel === 'about' || /registrar/i.test(l.title || ''));
        return {name, ianaId: ianaId ? ianaId.identifier : '', abuseEmail, url: url ? url.href : ''};
      }
      const inner = findRegistrar(e.entities);
      if (inner) return inner;
    }
    return null;
  }

  const HOSTS = [[/cloudflare/, 'Cloudflare'], [/hostinger|dns-parking/, 'Hostinger'], [/domaincontrol|secureserver/, 'GoDaddy'], [/registrar-servers|namecheaphosting/, 'Namecheap'],
    [/googledomains|google\.com|ns-cloud/, 'Google'], [/awsdns/, 'Amazon AWS'], [/azure-dns/, 'Microsoft Azure'], [/wixdns/, 'Wix'], [/squarespace/, 'Squarespace'], [/shopify/, 'Shopify'],
    [/bigrock/, 'BigRock'], [/hostgator/, 'HostGator'], [/bluehost/, 'Bluehost'], [/digitalocean/, 'DigitalOcean'], [/vercel/, 'Vercel'], [/netlify/, 'Netlify'], [/nsone/, 'NS1'], [/zoho/, 'Zoho'],
    [/wordpress\.com/, 'WordPress.com'], [/parking|sedoparking|bodis|above\.com|parkingcrew|afternic|dan\.com|uniregistry/, 'Parked / for sale']];
  function hostHint(ns) { for (const n of ns) for (const [re, name] of HOSTS) if (re.test(n)) return name; return ''; }

  /** Turn a raw RDAP JSON response into the fields the app shows. */
  function parse(domain, j, now = Date.now()) {
    const ev = {};
    (j.events || []).forEach(e => { if (e.eventAction && e.eventDate) ev[e.eventAction.toLowerCase()] = e.eventDate; });
    const status = (j.status || []).map(s => s.toLowerCase());
    const ns = (j.nameservers || []).map(n => String(n.ldhName || n.unicodeName || '').toLowerCase()).filter(Boolean);
    const expires = ev['expiration'] || ev['registrar expiration'] || '';
    const created = ev['registration'] || '';
    const updated = ev['last changed'] || ev['last update'] || '';
    const exp = expires ? Date.parse(expires) : NaN;
    const daysLeft = isNaN(exp) ? null : Math.floor((exp - now) / DAY);
    const r = {domain, found: true, expires, created, updated, daysLeft, status, nameservers: ns, host: hostHint(ns),
      registrar: findRegistrar(j.entities), ageYears: created ? Math.floor((now - Date.parse(created)) / (365.25 * DAY)) : null};
    r.phase = phaseOf(r);
    r.dropEstimate = dropEstimate(r, now);
    return r;
  }

  /** Where the domain is in its life: active → expiring → grace → redemption → pending delete → available. */
  function phaseOf(r) {
    if (!r.found) return 'available';
    const s = r.status.join(' ');
    if (/pending ?delete/.test(s)) return 'pendingDelete';
    if (/redemption/.test(s)) return 'redemption';
    if (/auto ?renew|renew period/.test(s) && r.daysLeft != null && r.daysLeft < 0) return 'grace';
    if (r.daysLeft == null) return 'unknown';
    if (r.daysLeft < 0) return 'grace';
    if (r.daysLeft <= 30) return 'soon';
    if (r.daysLeft <= 90) return 'watch';
    return 'active';
  }
  /** Rough date the domain could become free to register. Registries differ, so this is only a guide. */
  function dropEstimate(r, now) {
    const add = (iso, d) => new Date(Date.parse(iso) + d * DAY).toISOString();
    if (r.phase === 'pendingDelete') return add(r.updated || new Date(now).toISOString(), 5);
    if (r.phase === 'redemption') return add(r.updated || new Date(now).toISOString(), 35);
    if (r.phase === 'grace' && r.expires) return add(r.expires, 80);
    return '';
  }

  /** Simple quality signals a buyer looks at. Not a valuation. */
  function quality(domain, r) {
    const name = domain.split('.')[0], tld = domain.slice(name.length + 1);
    const pts = [], add = (ok, label, w) => pts.push({ok, label, w});
    add(name.length <= 8, `${name.length} letters ${name.length <= 8 ? '(short)' : name.length <= 12 ? '(medium)' : '(long)'}`, 2);
    add(['com', 'in', 'co.in', 'net', 'org', 'io', 'ai'].includes(tld), `.${tld} ending`, 2);
    add(!/-/.test(name), /-/.test(name) ? 'Has a hyphen' : 'No hyphen', 1);
    add(!/\d/.test(name), /\d/.test(name) ? 'Has numbers' : 'No numbers', 1);
    add(r && r.ageYears >= 5, r && r.ageYears != null ? `${r.ageYears} year${r.ageYears === 1 ? '' : 's'} old` : 'Age unknown', 2);
    add(/^[a-z]+$/.test(name) && /[aeiou]/.test(name) && !/[^aeiou]{5}/.test(name), 'Easy to say', 2);
    const score = pts.reduce((s, p) => s + (p.ok ? p.w : 0), 0);
    return {score, max: 10, points: pts};
  }

  /**
   * Look a domain up. Returns parsed fields, {found:false} when the registry has no record
   * (often means it is free to register), or {error} when the lookup could not be made.
   */
  async function lookup(domain, opts = {}) {
    const fetchFn = opts.fetch || ((u, o) => fetch(u, o));
    domain = normalize(domain);
    if (!domain) return {domain: '', error: 'Not a valid domain'};
    const tld = domain.split('.').pop();
    const map = await servers(fetchFn);
    const bases = [map[tld], FALLBACK].filter(Boolean);
    let lastErr = '';
    for (const base of bases) {
      try {
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const t = ctrl ? setTimeout(() => ctrl.abort(), opts.timeout || 12000) : null;
        const res = await fetchFn(base + 'domain/' + encodeURIComponent(domain), {headers: {accept: 'application/rdap+json, application/json'}, signal: ctrl ? ctrl.signal : undefined});
        if (t) clearTimeout(t);
        if (res.status === 404) return {domain, found: false, phase: 'available', status: [], nameservers: [], checkedVia: base};
        if (res.status === 429) { lastErr = 'The registry is rate-limiting lookups. Try again in a minute.'; continue; }
        if (!res.ok) { lastErr = 'Registry answered ' + res.status; continue; }
        const j = await res.json();
        const r = parse(domain, j, opts.now || Date.now());
        r.checkedVia = base;
        return r;
      } catch (e) {
        lastErr = e && e.name === 'AbortError' ? 'The registry took too long to answer' : 'Could not reach the registry for .' + tld;
      }
    }
    if (!map[tld] && Object.keys(map).length) lastErr = `.${tld} does not publish RDAP data yet, so its renewal date can't be looked up here.`;
    return {domain, error: lastErr || 'Lookup failed'};
  }

  return {normalize, parseList, lookup, parse, phaseOf, quality, hostHint, _reset: () => { bootstrap = null; }};
});
