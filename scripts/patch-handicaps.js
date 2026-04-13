#!/usr/bin/env node
/**
 * patch-handicaps.js
 *
 * Reads handicaps.json and patches the `hi` values in players.html
 * and player.html by rewriting the players data inline.
 *
 * Usage:
 *   node scripts/patch-handicaps.js
 *   node scripts/patch-handicaps.js --hcp path/to/handicaps.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const HCP_PATH = flag('--hcp') ?? path.join(__dirname, '../handicaps.json');
const ROOT     = path.join(__dirname, '..');

if (!fs.existsSync(HCP_PATH)) {
  console.error(`handicaps.json not found: ${HCP_PATH}`);
  console.error('Run fetch-handicaps.js first.');
  process.exit(1);
}

const handicaps = JSON.parse(fs.readFileSync(HCP_PATH, 'utf8'));

// Build lookup: id → handicap_index
const lookup = {};
for (const p of handicaps) {
  if (p.id && p.handicap_index != null && !p.error) {
    lookup[p.id] = parseFloat(p.handicap_index);
  }
}

if (Object.keys(lookup).length === 0) {
  console.warn('Warning: no GHIN data found in handicaps.json — check for errors in fetch step.');
  process.exit(0);
}

function patchFile(filePath) {
  const name = path.basename(filePath);
  let html = fs.readFileSync(filePath, 'utf8');
  let updated = 0;
  let unchanged = 0;

  // players.html uses array syntax:  { id:'eric-anderson', ..., hi: 1.9 }
  // player.html uses object syntax:  'eric-anderson': { ..., hi: 1.9, ... }
  // Both have hi: N.N somewhere in the same JS object block as the player id.

  // Patch array-style entries (players.html): { id:'slug', ..., hi: X }
  html = html.replace(
    /(\{\s*id:'([\w-]+)'[^}]*?)(?:,\s*hi:\s*-?[\d.]+)?(\s*\})/g,
    (match, prefix, id, suffix) => {
      if (!(id in lookup)) return match;
      const newHi = lookup[id];
      const existing = match.match(/,\s*hi:\s*(-?[\d.]+)/);
      if (existing && parseFloat(existing[1]) === newHi) { unchanged++; return match; }
      const stripped = prefix.replace(/,\s*hi:\s*-?[\d.]+/, '');
      updated++;
      return `${stripped}, hi: ${newHi}${suffix}`;
    }
  );

  // Patch object-style entries (player.html): 'slug': { ..., hi: X, ... }
  // These objects can span multiple lines, so we target the hi: value by finding
  // the player key and then replacing hi within the next occurrence.
  for (const [id, newHi] of Object.entries(lookup)) {
    // Match the player key followed (anywhere in its block) by hi: value
    const keyPattern = new RegExp(
      `('${id}'\\s*:\\s*\\{[^}]*?)(,\\s*hi:\\s*-?[\\d.]+)([^}]*?\\})`,
      'g'
    );
    const before = html;
    html = html.replace(keyPattern, (match, pre, hiPart, post) => {
      const existing = parseFloat(hiPart.match(/-?[\d.]+/)[0]);
      if (existing === newHi) { unchanged++; return match; }
      updated++;
      return `${pre}, hi: ${newHi}${post}`;
    });
    // If no hi existed yet in a multi-line block, skip (will be added on next manual update)
  }

  fs.writeFileSync(filePath, html);
  console.log(`Patched ${name}: ${updated} updated, ${unchanged} unchanged.`);
}

patchFile(path.join(ROOT, 'players.html'));
patchFile(path.join(ROOT, 'player.html'));
