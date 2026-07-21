/* =========================================================================
   AI Stylist — a photo-your-clothes / suggest-outfits web app.
   Pure vanilla JS, no build step. Everything (wardrobe + API key) lives in
   the browser's localStorage, so the app is a single static site you can host
   on GitHub Pages. The Gemini API key is entered by the user at runtime and
   is NEVER written into the source code or the repository.
   ========================================================================= */

'use strict';

// ---- storage keys ---------------------------------------------------------
const LS_KEY   = 'stylist.apiKey';
const LS_MODEL = 'stylist.model';
const LS_WARD  = 'stylist.wardrobe';
const DEFAULT_MODEL = 'gemini-2.0-flash';

// When the Cloudflare Worker proxy is deployed, put its URL here. Once set, the
// app calls the proxy (which holds YOUR hidden key) and no longer asks users
// for a key at all. Leave empty to fall back to "bring your own key" mode.
const PROXY_URL = 'https://ai-stylist-proxy.ab30-apps.workers.dev';
const useProxy = () => PROXY_URL.length > 0;

// ---- tiny DOM helpers -----------------------------------------------------
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---- app state ------------------------------------------------------------
let wardrobe = load(LS_WARD, []);      // [{id, img, name, category, color, style, season}]
let occasion = 'Casual';

// =====================================================================
//  Boot
// =====================================================================
init();

function init() {
  // restore settings into the form
  $('#apiKey').value = load(LS_KEY, '');
  $('#model').value  = load(LS_MODEL, DEFAULT_MODEL);
  if (useProxy()) hideKeyUI();     // proxy holds the key — users never enter one
  refreshKeyDot();

  // navigation
  $$('.navbtn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // wardrobe
  $('#photoInput').addEventListener('change', onPhotoChosen);

  // suggest
  $$('#occasionChips .chip').forEach((c) => c.addEventListener('click', () => {
    $$('#occasionChips .chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    occasion = c.dataset.occ;
  }));
  $('#suggestBtn').addEventListener('click', onSuggest);

  // settings
  $('#saveSettings').addEventListener('click', onSaveSettings);
  $('#exportBtn').addEventListener('click', exportWardrobe);
  $('#clearBtn').addEventListener('click', clearWardrobe);

  renderWardrobe();
}

// =====================================================================
//  Navigation
// =====================================================================
function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.remove('active'));
  $('#tab-' + name).classList.add('active');
  $$('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  window.scrollTo(0, 0);
}

// =====================================================================
//  Settings
// =====================================================================
function onSaveSettings() {
  save(LS_KEY, $('#apiKey').value.trim());
  save(LS_MODEL, $('#model').value.trim() || DEFAULT_MODEL);
  refreshKeyDot();
  toast('Saved ✓');
}

function refreshKeyDot() {
  $('#statusDot').classList.toggle('ok', useProxy() || !!load(LS_KEY, ''));
}

// Hide the "enter your key" section when the proxy is providing the key.
function hideKeyUI() {
  const k = $('#apiKey');
  [k, k.previousElementSibling, k.nextElementSibling].forEach((el) => {
    if (el) el.style.display = 'none';
  });
}

function getKey()   { return load(LS_KEY, ''); }
function getModel() { return load(LS_MODEL, DEFAULT_MODEL); }

// =====================================================================
//  Adding a clothing item (photo -> resize -> AI tag -> save)
// =====================================================================
async function onPhotoChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';                 // allow re-picking the same file later
  if (!file) return;

  if (!useProxy() && !getKey()) {
    toast('Add your Gemini API key in Settings first');
    switchTab('settings');
    return;
  }

  try {
    showOverlay('Looking at your item…');
    const img = await fileToResizedDataUrl(file, 512, 0.7);
    const tags = await analyzeItem(img);
    wardrobe.push({ id: uid(), img, ...tags });
    save(LS_WARD, wardrobe);
    renderWardrobe();
    switchTab('wardrobe');
    toast('Added: ' + tags.name);
  } catch (err) {
    console.error(err);
    toast('Could not add item: ' + err.message);
  } finally {
    hideOverlay();
  }
}

// Ask Gemini to describe a single garment as structured JSON.
async function analyzeItem(dataUrl) {
  const prompt =
    'You are a fashion cataloguer. Look at the single clothing item in this photo. ' +
    'Reply ONLY with minified JSON, no markdown, using exactly these keys: ' +
    '"name" (2-4 words), "category" (one of: top, bottom, outerwear, dress, shoes, accessory), ' +
    '"color" (main colours in plain words), "style" (e.g. casual, formal, sporty, streetwear), ' +
    '"season" (one of: all, summer, winter, spring/fall). ' +
    'If unsure, make your best guess.';

  const text = await callGemini([
    { text: prompt },
    imagePart(dataUrl),
  ]);
  const obj = parseJson(text);
  return {
    name:     obj.name     || 'Item',
    category: obj.category || 'other',
    color:    obj.color    || '',
    style:    obj.style    || '',
    season:   obj.season   || 'all',
  };
}

// =====================================================================
//  Outfit suggestions
// =====================================================================
async function onSuggest() {
  if (!useProxy() && !getKey()) { toast('Add your Gemini API key in Settings first'); switchTab('settings'); return; }
  if (wardrobe.length < 2)      { toast('Add at least 2 items to your closet first'); switchTab('wardrobe'); return; }

  try {
    showOverlay('Styling you…');
    const outfits = await suggestOutfits(occasion, $('#notes').value.trim());
    renderSuggestions(outfits);
  } catch (err) {
    console.error(err);
    toast('Could not get suggestions: ' + err.message);
  } finally {
    hideOverlay();
  }
}

async function suggestOutfits(occ, notes) {
  // Send the wardrobe as a compact text list (cheap + reliable — no need to
  // re-send every image, since each item already has an AI description).
  const list = wardrobe
    .map((w) => `#${w.id} — ${w.name} [${w.category}, ${w.color}, ${w.style}, ${w.season}]`)
    .join('\n');

  const prompt =
    `You are a personal stylist. Here is the user's wardrobe:\n${list}\n\n` +
    `Occasion: ${occ}.` + (notes ? ` Extra context: ${notes}.` : '') + '\n\n' +
    'Put together up to 3 complete outfits using ONLY items from the wardrobe above. ' +
    'Each outfit should combine items that actually match (colour + formality). ' +
    'Reply ONLY with minified JSON: an array of objects with keys ' +
    '"title" (short name for the look), "items" (array of the exact item names used), ' +
    'and "why" (one friendly sentence on why it works). No markdown.';

  const text = await callGemini([{ text: prompt }]);
  const data = parseJson(text);
  return Array.isArray(data) ? data : (data.outfits || []);
}

// =====================================================================
//  Gemini REST call (browser -> Google, using the user's own key)
// =====================================================================
async function callGemini(parts) {
  const payload = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
  };

  let res;
  if (useProxy()) {
    // Proxy mode: send to the Worker, which injects the hidden key. No key here.
    res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, model: getModel() }),
    });
  } else {
    // Bring-your-own-key mode: call Google directly with the user's key.
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${getModel()}:generateContent?key=${encodeURIComponent(getKey())}`;
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`API ${res.status}. ${shorten(detail)}`);
  }

  const json = await res.json();
  const out = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) throw new Error('Empty response from model');
  return out;
}

function imagePart(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(meta)?.[1] || 'image/jpeg';
  return { inline_data: { mime_type: mime, data: b64 } };
}

// =====================================================================
//  Rendering
// =====================================================================
function renderWardrobe() {
  const grid = $('#wardrobeGrid');
  $('#wardrobeEmpty').style.display = wardrobe.length ? 'none' : 'block';
  grid.innerHTML = wardrobe.map((w) => `
    <div class="card">
      <button class="del" data-id="${w.id}" aria-label="Delete">✕</button>
      <img src="${w.img}" alt="${escapeHtml(w.name)}" />
      <div class="meta">
        <div class="name">${escapeHtml(w.name)}</div>
        <div class="tags">${escapeHtml([w.color, w.style, w.season].filter(Boolean).join(' · '))}</div>
      </div>
    </div>`).join('');

  grid.querySelectorAll('.del').forEach((b) =>
    b.addEventListener('click', () => deleteItem(b.dataset.id)));
}

function renderSuggestions(outfits) {
  const box = $('#suggestions');
  if (!outfits.length) { box.innerHTML = '<p class="empty">No outfit found — try adding more items.</p>'; return; }
  box.innerHTML = outfits.map((o) => `
    <div class="outfit">
      <h3>${escapeHtml(o.title || 'Outfit')}</h3>
      <ul>${(o.items || []).map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
      <div class="why">${escapeHtml(o.why || '')}</div>
    </div>`).join('');
}

function deleteItem(id) {
  wardrobe = wardrobe.filter((w) => w.id !== id);
  save(LS_WARD, wardrobe);
  renderWardrobe();
}

function clearWardrobe() {
  if (!wardrobe.length) return;
  if (!confirm('Delete all items from your closet?')) return;
  wardrobe = [];
  save(LS_WARD, wardrobe);
  renderWardrobe();
  toast('Closet cleared');
}

function exportWardrobe() {
  const blob = new Blob([JSON.stringify(wardrobe, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wardrobe-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// =====================================================================
//  Image helpers — resize on a canvas so localStorage stays small
// =====================================================================
function fileToResizedDataUrl(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Bad image file'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

// =====================================================================
//  Utilities
// =====================================================================
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch (e) { toast('Storage full — try fewer / smaller photos'); throw e; }
}

// Pull JSON out of a model reply even if it wrapped it in ```json fences.
function parseJson(text) {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = Math.min(...['{', '['].map((c) => { const i = t.indexOf(c); return i === -1 ? Infinity : i; }));
  if (start !== Infinity) t = t.slice(start);
  return JSON.parse(t);
}

function uid()  { return Math.random().toString(36).slice(2, 9); }
function shorten(s, n = 160) { return (s || '').replace(/\s+/g, ' ').slice(0, n); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- overlay + toast ------------------------------------------------------
function showOverlay(msg) { $('#overlayText').textContent = msg || 'Thinking…'; $('#overlay').classList.remove('hidden'); }
function hideOverlay()    { $('#overlay').classList.add('hidden'); }

let toastTimer;
function toast(msg) {
  clearTimeout(toastTimer);
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  toastTimer = setTimeout(() => el.remove(), 2600);
}
