#!/usr/bin/env node
/**
 * fetch-handicaps.js
 *
 * Logs into GHIN with credentials from env vars, then fetches each
 * player's current Handicap Index and writes handicaps.json.
 *
 * Env vars required:
 *   GHIN_EMAIL     — email address on the GHIN account
 *   GHIN_PASSWORD  — GHIN account password
 *
 * Usage:
 *   GHIN_EMAIL=you@example.com GHIN_PASSWORD=secret node scripts/fetch-handicaps.js
 *   node scripts/fetch-handicaps.js --csv path/to/players.csv --out path/to/out.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const CSV_PATH  = flag('--csv') ?? path.join(__dirname, '../players.csv');
const OUT_PATH  = flag('--out') ?? path.join(__dirname, '../handicaps.json');
const BASE_URL  = 'https://api2.ghin.com/api/v1';
const DELAY_MS  = 300;

const GHIN_EMAIL    = process.env.GHIN_EMAIL;
const GHIN_PASSWORD = process.env.GHIN_PASSWORD;

if (!GHIN_EMAIL || !GHIN_PASSWORD) {
  console.error('Error: GHIN_EMAIL and GHIN_PASSWORD env vars are required.');
  console.error('  GHIN_EMAIL=you@example.com GHIN_PASSWORD=secret node scripts/fetch-handicaps.js');
  process.exit(1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseCsv(text) {
  const [header, ...rows] = text.trim().split('\n');
  const keys = header.split(',').map(k => k.trim());
  return rows
    .filter(r => r.trim())
    .map(r => {
      const vals = r.split(',').map(v => v.trim());
      return Object.fromEntries(keys.map((k, i) => [k, vals[i] ?? '']));
    });
}

function makeGhinToken() {
  return Buffer.from(JSON.stringify({
    source: 'GHINcom',
    datetime: new Date().toISOString(),
  })).toString('base64');
}

async function login() {
  const res = await fetch(`${BASE_URL}/golfer_login.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Referer': 'https://www.ghin.com/',
    },
    body: JSON.stringify({
      user: {
        email_or_ghin: GHIN_EMAIL,
        password: GHIN_PASSWORD,
        remember_me: false,
      },
      token: makeGhinToken(),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHIN login failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const token = data?.golfer_user?.golfer_user_token;
  if (!token) throw new Error('No token in login response: ' + JSON.stringify(data).slice(0, 200));
  return token;
}

async function fetchHandicap(bearerToken, ghinNumber) {
  const url = `${BASE_URL}/golfers.json?per_page=1&page=1&golfer_id=${encodeURIComponent(ghinNumber)}&status=Active`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${bearerToken}`,
      'Referer': 'https://www.ghin.com/',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} for GHIN #${ghinNumber}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const golfer = data?.golfers?.[0];
  if (!golfer) throw new Error(`No golfer found for GHIN #${ghinNumber}`);

  return {
    handicap_index:   parseFloat(golfer.handicap_index),
    display_handicap: golfer.display_handicap,
    first_name:       golfer.first_name,
    last_name:        golfer.last_name,
    club_name:        golfer.club_name,
    low_hi:           golfer.low_hi,
    updated_at:       golfer.rev_date,
  };
}

// --- main ---
if (!fs.existsSync(CSV_PATH)) {
  console.error(`CSV not found: ${CSV_PATH}`);
  process.exit(1);
}

const players = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
const results = [];
let skipped = 0;

console.log('Logging into GHIN...');
let bearerToken;
try {
  bearerToken = await login();
  console.log('Login successful.\n');
} catch (err) {
  console.error('Login failed:', err.message);
  process.exit(1);
}

console.log(`Fetching handicaps for ${players.length} players...\n`);

for (const player of players) {
  if (!player.ghin_number || player.ghin_number === 'TBD' || player.ghin_number === '') {
    console.log(`  SKIP  ${player.name} (no GHIN number)`);
    results.push({ ...player, handicap_index: null, error: 'no_ghin' });
    skipped++;
    continue;
  }

  try {
    const hcp = await fetchHandicap(bearerToken, player.ghin_number);
    console.log(`  OK    ${player.name.padEnd(24)} HI: ${String(hcp.handicap_index).padStart(5)}  (${hcp.club_name ?? ''})`);
    results.push({ ...player, ...hcp });
  } catch (err) {
    console.warn(`  ERR   ${player.name}: ${err.message}`);
    results.push({ ...player, handicap_index: null, error: err.message });
  }

  await sleep(DELAY_MS);
}

fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
console.log(`\nDone. ${results.length - skipped} fetched, ${skipped} skipped.`);
console.log(`Output: ${OUT_PATH}`);
