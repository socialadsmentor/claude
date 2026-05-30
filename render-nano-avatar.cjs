#!/usr/bin/env node
/**
 * render-nano-avatar.cjs
 * Character-consistent image generation for Sam Bell using Google Gemini 2.5
 * Flash Image (Nano Banana), anchored on the canonical avatar reference set.
 *
 * Usage:
 *   node render-nano-avatar.cjs --prompt-file <path> --out <path.png> [--ref <imgpath>]
 *   node render-nano-avatar.cjs --prompt "<inline prompt>" --out <path.png>
 *
 * Defaults:
 *   ref = projects/claude-media/refs/sam-avatar/sam-primary.png
 *
 * RULES (creative.rules.md):
 *   - This is the standard path for ANY image that must contain Sam's likeness.
 *   - NEVER ask the model to render on-image text. Append the negative block.
 *     Title/headline/body text is added later via HyperFrames overlay.
 */
const fs = require('fs');
const path = require('path');

const HOME = process.env.USERPROFILE || process.env.HOME;
const DEFAULT_REF_DIR = path.join(HOME, 'projects', 'claude-media', 'refs', 'sam-avatar');

function listRefImages(dir) {
  return fs.readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => path.join(dir, f))
    .sort();
}
function mimeFor(p) {
  const e = p.toLowerCase();
  if (e.endsWith('.png')) return 'image/png';
  if (e.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
const NEGATIVE_BLOCK = '\n\nNO text, captions, words, watermarks, or logos rendered anywhere in the image. No generic stock-photo look. No floating UI icons. No duplicate people. No low-quality AI artifacts.';

function loadKey() {
  const txt = fs.readFileSync(path.join(HOME, '.claude', '.env'), 'utf8');
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('='); if (eq === -1) continue;
    const k = line.slice(0, eq).trim(); let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k === 'GOOGLE_API_KEY') return v;
  }
  throw new Error('GOOGLE_API_KEY not found in ~/.claude/.env');
}

function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt-file') o.promptFile = argv[++i];
    else if (a === '--prompt') o.prompt = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--ref') o.ref = argv[++i];
    else if (a === '--refs') o.refs = argv[++i];
    else if (a === '--no-negative') o.noNeg = true;
  }
  return o;
}

async function render({ key, prompt, refs, out }) {
  const imageParts = refs.map((r) => ({ inline_data: { mime_type: mimeFor(r), data: fs.readFileSync(r).toString('base64') } }));
  const model = 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents: [{ parts: [ { text: prompt }, ...imageParts ] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const txt = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
  const parts = JSON.parse(txt)?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData || p.inline_data);
  if (!img) throw new Error('no image part returned: ' + txt.slice(0, 300));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const buf = Buffer.from((img.inlineData || img.inline_data).data, 'base64');
  fs.writeFileSync(out, buf);
  return buf.length;
}

(async () => {
  const args = parseArgs(process.argv);
  if ((!args.prompt && !args.promptFile) || !args.out) {
    console.log('Usage: node render-nano-avatar.cjs (--prompt "..."|--prompt-file <p>) --out <p.png> [--ref <img>]');
    process.exit(1);
  }
  const key = loadKey();
  let prompt = args.prompt || fs.readFileSync(path.resolve(args.promptFile), 'utf8');
  if (!args.noNeg) prompt += NEGATIVE_BLOCK;
  // refs: --ref single, --refs comma-list, else ALL images in the canonical dir (multi-angle = best identity lock)
  let refs;
  if (args.ref) refs = [path.resolve(args.ref)];
  else if (args.refs) refs = args.refs.split(',').map((r) => path.resolve(r.trim()));
  else refs = listRefImages(DEFAULT_REF_DIR);
  if (!refs.length) { console.error('no reference images found'); process.exit(1); }
  try {
    const bytes = await render({ key, prompt, refs, out: path.resolve(args.out) });
    console.log(`OK -> ${args.out} (${bytes} bytes) | refs=${refs.map((r) => path.basename(r)).join(', ')}`);
  } catch (e) {
    console.error('RENDER FAILED: ' + e.message);
    process.exit(1);
  }
})();
