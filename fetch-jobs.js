// Daily Creative Operations job pull via SerpApi Google Jobs.
const fs = require('fs');

const SERPAPI_KEY = process.env.SERPAPI_KEY;
if (!SERPAPI_KEY) { console.error('Missing SERPAPI_KEY'); process.exit(1); }

const TITLE = 'Creative Operations';
const ANCHOR = { lat: 34.0265, lng: -118.4890 }; // ~1521 12th St, Santa Monica
const RADIUS_MILES = 10;

function haversineMiles(a, b) {
  const toRad = d => d * Math.PI / 180, R = 3958.8;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 +
    Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function postedHours(s) {
  if (!s) return 99999;
  s = s.toLowerCase();
  const n = parseInt(s) || 1;
  if (s.includes('hour') || s.includes('just') || s.includes('minute')) return n;
  if (s.includes('day')) return n * 24;
  if (s.includes('week')) return n * 168;
  if (s.includes('month')) return n * 720;
  return 99999;
}

const FALLBACK = {
  'santa monica, ca': {lat:34.0195,lng:-118.4912},
  'venice, ca': {lat:33.9850,lng:-118.4695},
  'marina del rey, ca': {lat:33.9802,lng:-118.4517},
  'culver city, ca': {lat:34.0211,lng:-118.3965},
  'west los angeles, ca': {lat:34.0395,lng:-118.4416},
  'brentwood, ca': {lat:34.0520,lng:-118.4730},
  'mar vista, ca': {lat:33.9994,lng:-118.4310},
  'playa vista, ca': {lat:33.9756,lng:-118.4263},
  'westwood, ca': {lat:34.0635,lng:-118.4455},
  'century city, ca': {lat:34.0577,lng:-118.4170},
  'pacific palisades, ca': {lat:34.0356,lng:-118.5253},
  'el segundo, ca': {lat:33.9192,lng:-118.4165},
};
const geoCache = {};
async function geocode(loc) {
  if (!loc) return null;
  const key = loc.trim().toLowerCase();
  if (geoCache[key] !== undefined) return geoCache[key];
  if (FALLBACK[key]) return (geoCache[key] = FALLBACK[key]);
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
      + encodeURIComponent(loc);
    const r = await fetch(url, { headers: { 'User-Agent': 'command-center-jobs/1.0' } });
    const j = await r.json();
    if (j && j[0]) {
      const c = { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
      await new Promise(res => setTimeout(res, 1100)); // be polite
      return (geoCache[key] = c);
    }
  } catch (e) {}
  return (geoCache[key] = null);
}

function isRemote(job) {
  const loc = (job.location || '').toLowerCase();
  if (loc.includes('remote') || loc.includes('anywhere')) return true;
  return !!(job.detected_extensions && job.detected_extensions.work_from_home);
}

async function serpQuery(q, location) {
  const p = new URLSearchParams({ engine:'google_jobs', q, hl:'en', api_key:SERPAPI_KEY });
  if (location) p.set('location', location);
  const r = await fetch('https://serpapi.com/search.json?' + p.toString());
  const j = await r.json();
  if (j.error) { console.error('SerpApi error:', j.error); return []; }
  return j.jobs_results || [];
}

function normalize(job, source) {
  const apply = (job.apply_options && job.apply_options[0]) || null;
  const de = job.detected_extensions || {};
  const title = job.title || '';
  const company = job.company_name || '';
  const idSource = (title + '|' + company).toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 0;
  for (let i = 0; i < idSource.length; i++) { h = ((h << 5) - h + idSource.charCodeAt(i)) | 0; }
  const id = 'j' + (h >>> 0).toString(36);
  return {
    id,
    title,
    company,
    location: job.location || '',
    via: job.via || '',
    posted: de.posted_at || '',
    schedule: de.schedule_type || '',
    salary: de.salary || '',
    description: job.description || '',
    link: apply ? apply.link : (job.share_link || ''),
    source,
  };
}

(async () => {
  const remoteRaw = await serpQuery(TITLE + ' remote', 'United States');
  const localRaw  = await serpQuery(TITLE, 'Santa Monica, California, United States');
  const out = [], seen = new Set();

  for (const job of remoteRaw) {
    if (!isRemote(job)) continue;
    const n = normalize(job, 'remote');
    const k = (n.title + '|' + n.company).toLowerCase();
    if (seen.has(k)) continue; seen.add(k);
    n.remote = true; n.distance_miles = null; out.push(n);
  }
  for (const job of localRaw) {
    if (isRemote(job)) continue;
    const n = normalize(job, 'local');
    const k = (n.title + '|' + n.company).toLowerCase();
    if (seen.has(k)) continue;
    const c = await geocode(n.location);
    if (!c) continue;
    const d = haversineMiles(ANCHOR, c);
    if (d > RADIUS_MILES) continue;
    seen.add(k);
    n.remote = false; n.distance_miles = Math.round(d * 10) / 10; out.push(n);
  }

  out.forEach(j => j._h = postedHours(j.posted));
  out.sort((a, b) => a._h - b._h);
  out.forEach(j => delete j._h);

  fs.writeFileSync('jobs.json',
    JSON.stringify({ updated_at: new Date().toISOString(), count: out.length, jobs: out }, null, 2));
  console.log('Wrote ' + out.length + ' jobs.');
})();
