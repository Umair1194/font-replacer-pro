import { defaultOptions, fontKey, matchStyle, type FontRef, type FontUsage, type Inventory, type Mapping, type Request, type Response, type Review, type Result, type ScanOptions, type Scope } from './shared';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const number = (n: number) => n.toLocaleString();
const elapsed = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
const send = (message: Request) => parent.postMessage({ pluginMessage: message }, '*');
type Mode = 'empty' | 'scan' | 'inventory' | 'review' | 'apply' | 'result';
let mode: Mode = 'empty';
let options = { ...defaultOptions };
let inventory: Inventory | undefined;
let review: Review | undefined;
let result: Result | undefined;
let catalog: FontRef[] = [];
let familyMap = new Map<string, FontRef[]>();
let mappings = new Map<string, FontRef>();
let selected = 0;
let initialized = false;
let rowLimit = 60;
let pickerSource: FontUsage | undefined;
let pickerFamily = '';
let pickerStyle = '';
let pickerMode: 'single' | 'all' = 'single';
let fontsReady = false;
let startupFailed = false;
let startupTimer: ReturnType<typeof setTimeout> | undefined;
let startupRetries = 0;
let pendingReview = false;
const primary = $<HTMLButtonElement>('primary');
const secondary = $<HTMLButtonElement>('secondary');
const workspace = $('workspace');
const picker = $<HTMLDialogElement>('font-dialog');

function notice(message = '', error = false) {
  $('notice').textContent = message; $('notice').hidden = !message; $('notice').className = `notice${error ? ' error' : ''}`;
}
function isBusy() { return mode === 'scan' || mode === 'apply'; }
function setMode(next: Mode) { mode = next; render(); }
function updateControls() {
  document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.scope === options.scope)); b.disabled = isBusy() || pendingReview; });
  for (const key of ['includeHidden', 'includeLocked', 'includeInstances', 'includeComponents'] as const) $(key).toggleAttribute('disabled', isBusy() || pendingReview);
  $('options-summary').textContent = `${options.includeHidden ? 'Hidden included' : 'Visible only'} · ${options.includeLocked ? 'Locked included' : 'Locked excluded'}`;
  primary.disabled = false; secondary.hidden = true; secondary.disabled = false;
  if (isBusy()) { primary.textContent = 'Cancel operation'; primary.disabled = false; }
  else if (mode === 'inventory') { primary.textContent = pendingReview ? 'Preparing review…' : 'Review replacements →'; primary.disabled = !mappings.size || pendingReview; secondary.textContent = 'Rescan'; secondary.hidden = false; }
  else if (mode === 'review') { primary.textContent = `Replace ${number(review?.layers || 0)} layers ↗`; secondary.textContent = 'Back'; secondary.hidden = false; }
  else { primary.textContent = mode === 'result' ? 'Scan again ↗' : `Scan ${options.scope === 'selection' ? 'selection' : options.scope === 'page' ? 'current page' : 'entire file'} ↗`; primary.disabled = !fontsReady || (options.scope === 'selection' && !selected); }
  if (!fontsReady && !isBusy()) { primary.textContent = startupFailed ? 'Retry connection ↻' : 'Loading available fonts…'; primary.disabled = !startupFailed; }
  $('footer-note').innerHTML = mode === 'review' ? 'Font metrics may change text wrapping and layout. · v0.1.2' : '<span class="privacy-dot"></span> Local processing. Your text stays in Figma. · v0.1.2';
}
function render() {
  updateControls();
  if (mode === 'empty') {
    workspace.innerHTML = `<div class="empty"><div class="type-demo" aria-hidden="true"><span class="type-before">Aa</span><span class="type-arrow">→</span><span class="type-after">Aa</span></div><h2>A fresh face for your file.</h2><p>Find the fonts in your design, choose their replacements, and make the switch in one batch.</p><div class="feature-line"><span>Mixed-font aware</span><span>Style-by-style control</span></div></div>`;
  } else if (isBusy()) {
    workspace.innerHTML = `<div class="progress-view"><div class="spinner" aria-hidden="true"></div><h2 id="progress-title">${mode === 'scan' ? 'Reading your typography' : 'Making the switch'}</h2><p id="progress-detail">${mode === 'scan' ? 'Scanning only your chosen scope.' : 'Loading destination fonts before any changes.'}</p><div id="progress-track" class="progress-track indeterminate" role="progressbar" aria-label="Operation progress"><span id="progress-fill"></span></div><p>${mode === 'apply' ? 'Cancel stops future changes. Completed edits remain.' : 'You can cancel this scan at any time.'}</p></div>`;
  } else if (mode === 'inventory' && inventory) renderInventory();
  else if (mode === 'review' && review) renderReview(review);
  else if (mode === 'result' && result) renderResult(result);
}
function stats(items: [number, string][]) { return `<div class="stats">${items.map(([value, label]) => `<div class="stat"><strong>${number(value)}</strong><span>${label}</span></div>`).join('')}</div>`; }
function renderInventory() {
  const inv = inventory!;
  if (!inv.fonts.length) {
    workspace.innerHTML = `<div class="empty"><div class="type-demo" aria-hidden="true"><span class="type-before">Aa</span><span class="type-arrow">∅</span></div><h2>No eligible text found.</h2><p>Try another scope or adjust scan options. Outlined text and images cannot be changed as fonts.</p></div>${skippedMarkup(inv)}`;
    return;
  }
  workspace.innerHTML = `<div class="workspace-heading"><div><h2>Your font inventory <span class="count-pill">${inv.fonts.length} styles</span></h2><p>${number(inv.layers)} text layers · ${escape(inv.pageName)}</p></div><button id="map-all" class="text-button" ${catalog.length ? '' : 'disabled'}>Map family ↗</button></div><div class="inventory-tools"><label class="search"><span aria-hidden="true">⌕</span><input id="inventory-search" placeholder="Filter source fonts…" aria-label="Filter source fonts"></label><span id="mapping-count" class="count-pill">${mappings.size} mapped</span></div><div class="table-labels"><span>SOURCE FONT</span><span></span><span>REPLACE WITH</span></div><div id="font-rows" class="font-rows"></div>${skippedMarkup(inv)}<div class="timing"><span class="dot"></span> Scanned in ${elapsed(inv.duration)} · ${number(inv.ranges)} font ranges</div>`;
  $('map-all').onclick = () => openPicker('all');
  $('inventory-search').oninput = () => { rowLimit = 60; renderRows(); };
  renderRows();
}
function skippedMarkup(inv: Inventory) {
  const entries = Object.entries(inv.skipped);
  return entries.length ? `<details class="skipped-details"><summary>${number(entries.reduce((s, [, n]) => s + n, 0))} text layers skipped</summary><ul>${entries.map(([reason, count]) => `<li>${escape(reason)}: ${number(count)}</li>`).join('')}</ul></details>` : '';
}
function renderRows() {
  const query = ($<HTMLInputElement>('inventory-search').value || '').toLowerCase();
  const rows = inventory!.fonts.filter(row => `${row.font.family} ${row.font.style}`.toLowerCase().includes(query));
  $('font-rows').innerHTML = rows.slice(0, rowLimit).map(row => {
    const index = inventory!.fonts.indexOf(row), target = mappings.get(row.key);
    return `<div class="font-row"><div><div class="font-family">${escape(row.font.family)}${row.missing ? '<span class="badge">Missing</span>' : ''}</div><div class="font-meta">${escape(row.font.style)}${row.font.variationSettings ? ' · Variable' : ''}<br>${number(row.layers)} ${row.layers === 1 ? 'layer' : 'layers'}${row.styled ? ' · Text style' : ''}</div></div><span class="row-arrow" aria-hidden="true">→</span><button class="target-button ${target ? 'mapped' : ''}" data-pick="${index}" aria-label="Replace ${escape(row.font.family)} ${escape(row.font.style)}${target ? ` with ${escape(target.family)} ${escape(target.style)}` : ''}">${target ? `<strong>${escape(target.family)}</strong><small>${escape(target.style)}</small>` : 'Choose font…'}<span class="chevron" aria-hidden="true">⌄</span></button>${target ? `<div class="row-tail"><button class="text-button" data-clear="${index}">Clear mapping</button></div>` : ''}</div>`;
  }).join('') || '<p class="no-results">No source fonts match your search.</p>';
  if (rows.length > rowLimit) $('font-rows').insertAdjacentHTML('beforeend', `<div class="more-row"><button id="more-rows" class="text-button">Show next ${Math.min(60, rows.length - rowLimit)} of ${number(rows.length)} styles</button></div>`);
  $('more-rows')?.addEventListener('click', () => { rowLimit += 60; renderRows(); });
  $('font-rows').querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b => b.onclick = () => openPicker('single', inventory!.fonts[Number(b.dataset.pick)]));
  $('font-rows').querySelectorAll<HTMLButtonElement>('[data-clear]').forEach(b => b.onclick = () => { mappings.delete(inventory!.fonts[Number(b.dataset.clear)].key); updateMapped(); });
}
function updateMapped() { review = undefined; $('mapping-count').textContent = `${mappings.size} mapped`; renderRows(); updateControls(); }
function renderReview(r: Review) {
  workspace.innerHTML = `<div class="review-card"><div class="review-top"><p class="eyebrow">READY WHEN YOU ARE</p><h2>Review your font swap.</h2><p>Your mappings apply to the original fonts in the scan, so replacements won’t cascade.</p></div>${stats([[r.layers, 'text layers'], [r.ranges, 'range changes'], [r.fontsToLoad, 'fonts to load']])}<div class="review-notes"><p><strong>Scope:</strong> ${escape(inventory?.pageName || '')} · ${options.scope === 'selection' ? 'Scanned selection' : options.scope === 'page' ? 'Current page at scan time' : 'Scanned pages'}</p><p>Text content, color, size, and spacing stay as authored. The new font can change wrapping and dimensions.</p>${r.styledLayers ? `<p><strong>${number(r.styledLayers)} styled layers:</strong> changing their font may create text-style overrides. Shared style definitions are not migrated.</p>` : ''}${r.variableRanges ? `<p><strong>${number(r.variableRanges)} variable-font ranges:</strong> source axes reset to the selected destination’s named style. Custom axis migration is not included in this build.</p>` : ''}${options.includeComponents ? '<p><strong>Main components included:</strong> edits can propagate to instances outside this scope.</p>' : ''}${options.includeInstances ? '<p><strong>Instances included:</strong> these edits can create font overrides.</p>' : ''}<p>Layers edited since scanning will be skipped. Cancel leaves completed edits in place.</p></div></div>`;
}
function renderResult(r: Result) {
  const partial = r.cancelled || r.failedLayers > 0 || r.skippedLayers > 0;
  workspace.innerHTML = `<div class="review-card"><div class="result-heading"><div class="success-icon" aria-hidden="true">${partial ? '↗' : '✓'}</div><p class="eyebrow">${r.cancelled ? 'OPERATION STOPPED' : partial ? 'COMPLETED WITH NOTES' : 'FONT SWAP COMPLETE'}</p><h2>${r.cancelled ? 'Stopped at a safe boundary.' : r.changedLayers ? 'A new look, applied.' : 'No layers were changed.'}</h2><p>${number(r.changedRanges)} range changes completed in ${elapsed(r.duration)}.</p></div>${stats([[r.changedLayers, 'layers changed'], [r.skippedLayers, 'layers skipped'], [r.failedLayers, 'layers with errors']])}<div class="result-note">Use Figma’s native Undo to revert completed edits. Scan again before another replacement.</div></div>${r.issues.length ? `<div class="issues"><div class="section-label"><label>OPERATION NOTES</label><span class="context">${r.issues.length} layers</span></div>${r.issues.slice(0, 100).map((issue, i) => `<div class="issue"><div><strong>${escape(issue.name)}</strong><p>${escape(issue.reason)}</p></div><button class="text-button" data-focus="${i}">Locate ↗</button></div>`).join('')}${r.issues.length > 100 ? '<p class="timing">Showing the first 100 notes.</p>' : ''}</div>` : ''}`;
  workspace.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach(b => b.onclick = () => send({ type: 'FOCUS', id: r.issues[Number(b.dataset.focus)].id }));
}
function openPicker(nextMode: 'single' | 'all', source?: FontUsage) {
  pickerMode = nextMode; pickerSource = source;
  const target = source ? mappings.get(source.key) : undefined;
  pickerFamily = target?.family || ''; pickerStyle = target?.style || '';
  $('picker-title').textContent = nextMode === 'all' ? 'Map to one family' : `${source!.font.family} ${source!.font.style}`;
  $<HTMLInputElement>('font-search').value = '';
  $('choose-font').textContent = nextMode === 'all' ? 'Map matching styles' : 'Use font';
  renderFamilies(); renderStyles(); picker.showModal(); $<HTMLInputElement>('font-search').focus();
}
function renderFamilies() {
  const query = $<HTMLInputElement>('font-search').value.toLowerCase();
  const names = [...familyMap.keys()].filter(name => name.toLowerCase().includes(query));
  $('family-list').innerHTML = names.slice(0, 100).map(name => `<button aria-pressed="${name === pickerFamily}" data-family="${escape(name)}">${escape(name)}</button>`).join('') || '<p class="no-results">No available families.</p>';
  if (names.length > 100) $('family-list').insertAdjacentHTML('beforeend', '<p class="no-results">Keep typing to narrow these results.</p>');
  $('family-list').querySelectorAll<HTMLButtonElement>('[data-family]').forEach(b => b.onclick = () => { pickerFamily = b.dataset.family!; pickerStyle = ''; renderFamilies(); renderStyles(); });
}
function renderStyles() {
  const styles = familyMap.get(pickerFamily) || [];
  if (pickerMode === 'all') {
    $('style-list').innerHTML = pickerFamily ? `<p class="no-results">${styles.length} styles available.<br><br>Each source style is matched by name. Ambiguous styles are left for you to choose.</p>` : '<p class="no-results">Choose a destination family.</p>';
  } else {
    if (!pickerStyle && pickerSource && pickerFamily) pickerStyle = matchStyle(pickerSource.font, styles)?.style || '';
    $('style-list').innerHTML = styles.map(font => `<button aria-pressed="${font.style === pickerStyle}" data-style="${escape(font.style)}">${escape(font.style)}</button>`).join('') || '<p class="no-results">Choose a family to see its styles.</p>';
    $('style-list').querySelectorAll<HTMLButtonElement>('[data-style]').forEach(b => b.onclick = () => { pickerStyle = b.dataset.style!; renderStyles(); });
  }
  $<HTMLButtonElement>('choose-font').disabled = !pickerFamily || (pickerMode === 'single' && !pickerStyle);
  $('picker-note').textContent = pickerMode === 'all' ? 'Applies across the full inventory. Existing mappings are kept where a style cannot be matched.' : 'These are fonts available to Figma. Font names use the interface font; this is not a typeface preview.';
}
$('choose-font').onclick = () => {
  const targets = familyMap.get(pickerFamily) || [];
  if (pickerMode === 'single' && pickerSource) {
    const target = targets.find(f => f.style === pickerStyle);
    if (target) {
      if (fontKey(target) === pickerSource.key) mappings.delete(pickerSource.key); else mappings.set(pickerSource.key, target);
    }
    notice();
  } else {
    let unresolved = 0;
    for (const row of inventory!.fonts) {
      const target = matchStyle(row.font, targets);
      if (!target) { unresolved++; continue; }
      if (fontKey(target) === row.key) mappings.delete(row.key); else mappings.set(row.key, target);
    }
    notice(unresolved ? `${unresolved} source styles need a manual destination. Their existing mappings were kept.` : 'Matching styles mapped. You can adjust each destination below.');
  }
  picker.close(); updateMapped();
};
$('font-search').oninput = renderFamilies;
$('close-picker').onclick = () => picker.close();
$('refresh-fonts').onclick = () => { send({ type: 'REFRESH_FONTS' }); $('picker-note').textContent = 'Refreshing fonts available in Figma…'; };
$('help').onclick = () => $<HTMLDialogElement>('help-dialog').showModal();
$('close-help').onclick = () => $<HTMLDialogElement>('help-dialog').close();
function resetWorkspace() { inventory = undefined; review = undefined; mappings.clear(); notice(); setMode('empty'); }
document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach(b => b.onclick = () => { options.scope = b.dataset.scope as Scope; resetWorkspace(); });
for (const key of ['includeHidden', 'includeLocked', 'includeInstances', 'includeComponents'] as const) $<HTMLInputElement>(key).onchange = e => { options[key] = (e.target as HTMLInputElement).checked; resetWorkspace(); };
function startScan() { notice(); pendingReview = false; mappings.clear(); inventory = undefined; review = undefined; setMode('scan'); send({ type: 'SCAN', options: { ...options } }); }
primary.onclick = () => {
  if (!fontsReady && startupFailed) { connect(); }
  else if (isBusy()) { send({ type: 'CANCEL' }); primary.textContent = 'Stopping…'; primary.disabled = true; }
  else if (mode === 'inventory' && inventory) { pendingReview = true; updateControls(); const values: Mapping[] = [...mappings].map(([source, target]) => ({ source, target })); send({ type: 'PLAN', inventoryId: inventory.id, mappings: values }); }
  else if (mode === 'review' && review) { const planId = review.id; setMode('apply'); notice(); send({ type: 'APPLY', planId }); }
  else startScan();
};
secondary.onclick = () => { if (mode === 'review') setMode('inventory'); else startScan(); };
window.onmessage = (event: MessageEvent<{ pluginMessage?: Response }>) => {
  // Follow Figma's pluginMessage envelope. A host relay need not identify
  // itself as the immediate parent (or null), so Window identity is not a
  // reliable transport check here.
  const message = event.data?.pluginMessage;
  if (!message || typeof message.type !== 'string') return;
  switch (message.type) {
    case 'CONTEXT':
      selected = message.selected; $('selection-count').textContent = String(selected); $('context').textContent = message.pageName;
      if (!initialized) { options.scope = selected ? 'selection' : 'page'; initialized = true; }
      updateControls(); break;
    case 'FONTS':
      if (!Array.isArray(message.fonts)) return;
      if (startupTimer !== undefined) clearTimeout(startupTimer);
      catalog = message.fonts; fontsReady = true; startupFailed = false; familyMap = new Map();
      for (const font of catalog) { const list = familyMap.get(font.family) || []; if (!list.some(f => f.style === font.style)) list.push(font); familyMap.set(font.family, list); }
      updateControls(); if (picker.open) { renderFamilies(); renderStyles(); } break;
    case 'BUSY': setMode(message.operation); break;
    case 'PROGRESS': {
      if (!isBusy()) break;
      $('progress-title').textContent = message.stage;
      $('progress-detail').textContent = message.total ? `${number(message.done)} of ${number(message.total)}` : `${number(message.done)} text layers checked`;
      $('progress-track').classList.toggle('indeterminate', !message.total);
      if (message.total) { $('progress-fill').style.width = `${Math.min(100, message.done / message.total * 100)}%`; $('progress-track').setAttribute('aria-valuenow', String(message.done)); $('progress-track').setAttribute('aria-valuemax', String(message.total)); }
      break;
    }
    case 'INVENTORY': inventory = message.inventory; pendingReview = false; rowLimit = 60; setMode('inventory'); break;
    case 'REVIEW': review = message.review; pendingReview = false; setMode('review'); break;
    case 'RESULT': result = message.result; pendingReview = false; setMode('result'); break;
    case 'CANCELLED': resetWorkspace(); notice('Scan cancelled. No text was changed.'); break;
    case 'INVALIDATED':
      if (!isBusy() && (mode === 'inventory' || mode === 'review')) { resetWorkspace(); notice(message.reason); } break;
    case 'ERROR':
      pendingReview = false;
      if (!fontsReady) { startupFailed = true; if (startupTimer !== undefined) clearTimeout(startupTimer); }
      if (isBusy()) { mode = 'empty'; inventory = undefined; review = undefined; render(); } else updateControls();
      notice(message.message, true); break;
  }
};
function connect() {
  if (startupTimer !== undefined) clearTimeout(startupTimer);
  startupFailed = false; startupRetries = 0; notice(); updateControls();
  const started = Date.now();
  const check = () => {
    if (fontsReady || startupFailed) return;
    if (Date.now() - started >= 25000) {
      startupFailed = true;
      notice(initialized ? 'Figma has not returned its font list. Retry the connection.' : 'The plugin could not connect to Figma. Retry, or close and reopen the development plugin.', true);
      updateControls(); return;
    }
    if (!initialized && startupRetries < 5) { startupRetries++; send({ type: 'INIT' }); }
    startupTimer = setTimeout(check, 1000);
  };
  // Schedule before sending so even an immediate host reply can clear the timer.
  startupTimer = setTimeout(check, 1000);
  send({ type: 'INIT' });
}
$('resize').onpointerdown = event => {
  const startX = event.screenX, startY = event.screenY, width = window.innerWidth, height = window.innerHeight;
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  handle.onpointermove = e => send({ type: 'RESIZE', width: width + e.screenX - startX, height: height + e.screenY - startY });
  handle.onpointerup = () => { handle.onpointermove = null; handle.onpointerup = null; };
};
console.info('[Font Replacer Pro 0.1.2] UI ready');
render(); connect();
