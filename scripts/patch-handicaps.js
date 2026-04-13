#!/usr/bin/env node
/**
 * patch-handicaps.js
 *
 * Reads handicaps.json and patches the `hi` values in players.html
 * by rewriting the players array inline.
 *
 * Usage:
 *   node scripts/patch-handicaps.js
 *   node scripts/patch-handicaps.js --hcp path/to/handicaps.json --html path/to/players.html
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const HCP_PATH  = flag('--hcp')  ?? path.join(__dirname, '../handicaps.json');
const HTML_PATH = flag('--html') ?? path.join(__dirname, '../players.html');

if (!fs.existsSync(HCP_PATH)) {
  console.error(`handicaps.json not found: ${HCP_PATH}`);
  console.error('Run fetch-handicaps.js first.');
  process.exit(1);
}

const handicaps = JSON.parse(fs.readFileSync(HCP_PATH, 'utf8'));

// Build a lookup: id → handicap_index
const lookup = {};
for (const p of handicaps) {
  if (p.id && p.handicap_index != null && !p.error) {
    lookup[p.id] = parseFloat(p.handicap_index);
  }
}

let html = fs.readFileSync(HTML_PATH, 'utf8');
let updated = 0;
let unchanged = 0;

// Match each player object in the players array.
// Handles both `hi: 9.8` (existing) and missing `hi` entirely.
html = html.replace(
  /(\{\s*id:'([\w-]+)'[^}]*?)(?:,\s*hi:\s*-?[\d.]+)?(\s*\})/g,
  (match, prefix, id, suffix) => {
    if (!(id in lookup)) return match; // no GHIN data, leave untouched

    const newHi = lookup[id];

    // Check if value is already current
    const existingHiMatch = match.match(/,\s*hi:\s*(-?[\d.]+)/);
    if (existingHiMatch && parseFloat(existingHiMatch[1]) === newHi) {
      unchanged++;
      return match;
    }

    // Remove old hi if present, then append new one before closing brace
    const stripped = prefix.replace(/,\s*hi:\s*-?[\d.]+/, '');
    updated++;
    return `${stripped}, hi: ${newHi}${suffix}`;
  }
);

fs.writeFileSync(HTML_PATH, html);
console.log(`Patched players.html: ${updated} updated, ${unchanged} unchanged.`);

if (updated === 0 && Object.keys(lookup).length === 0) {
  console.warn('Warning: no GHIN data found in handicaps.json — check for errors in fetch step.');
}
