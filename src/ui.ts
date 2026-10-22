import { axisLabel, defaultOptions, fontKey, isResponse, loadKey, matchStyle, normalizedStyle, type FontRef, type FontUsage, type Inventory, type Mapping, type Request, type Review, type Result, type Scope } from './shared';
import { icons } from './icons';
import { VERSION } from './version';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (n: number) => n.toLocaleString();
const elapsed = (ms: number) => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
const send = (message: Request) => parent.postMessage({ pluginMessage: message }, '*');
type Mode = 'empty' | 'scan' | 'plan' | 'inventory' | 'review' | 'apply' | 'result';
type Filter = 'all' | 'mapped' | 'unmapped' | 'attention';
let mode: Mode = 'empty', options = { ...defaultOptions }, inventory: Inventory | undefined, review: Review | undefined, result: Result | undefined;
let catalog: FontRef[] = [], families = new Map<string, FontRef[]>(), available = new Set<string>(), mappings = new Map<string, FontRef>();
let selected = 0, initialized = false, fontsReady = false, startupFailed = false, stale = false, stopping = false;
let pageChoices: { id: string; name: string }[] = [], selectedPages = new Set<string>(), recents: string[] = [];
let activeRequest = '', serial = 0, startupTimer: ReturnType<typeof setTimeout> | undefined, startupRetries = 0;
let filter: Filter = 'all', query = '', rowLimit = 80, compact = false;
let expanded = new Map<string, boolean>(), pickerSource: FontUsage | undefined, pickerScope: string | undefined, pickerFamily = '', pickerStyle = '', pickerLimit = 80;
let pickerOpener: HTMLElement | undefined, issueFilter = 'all', issueLimit = 60;
const primary = $<HTMLButtonElement>('primary'), secondary = $<HTMLButtonElement>('secondary'), workspace = $('workspace'), picker = $<HTMLDialogElement>('font-dialog');
const busy = () => mode === 'scan' || mode === 'plan' || mode === 'apply';
function notice(message = '', error = false) { $('notice').textContent = message; $('notice').hidden = !message; $('notice').className = `notice${error ? ' error' : ''}`; }
function announce(message: string) { $('announcer').textContent = message; }
function setMode(value: Mode) { mode = value; stopping = false; render(); }
function request(message: Request, next: 'scan' | 'plan' | 'apply') { activeRequest = `operation-${++serial}`; setMode(next); send({ ...message, requestId: activeRequest }); }
function invalidTarget(font: FontRef) { return !available.has(loadKey(font)); }
function attention(row: FontUsage) { const target = mappings.get(row.key); return (fontsReady && row.missing) || !!row.font.variationSettings || (!!target && invalidTarget(target)); }
function optionsChanged() {
  delete options.onlyNodeIds;
  options.pageIds = [...selectedPages]; review = undefined;
  if (inventory) { stale = true; notice('Scope changed. Refresh to keep and revalidate your mappings.'); setMode('inventory'); }
  updateControls();
}
function updateControls() {
  document.querySelectorAll<HTMLButtonElement>('[data-scope]').forEach(button => { const checked = button.dataset.scope === options.scope; button.setAttribute('aria-checked', String(checked)); button.tabIndex = checked ? 0 : -1; button.disabled = busy(); });
  for (const key of ['includeHidden', 'includeLocked', 'includeInstances', 'includeComponents', 'fastScan']) $(key).toggleAttribute('disabled', busy());
  $('pages-panel').hidden = options.scope !== 'pages';
  $('options-summary').textContent = `${options.fastScan ? 'Fast' : 'Exact counts'} · ${options.includeHidden ? 'Hidden included' : 'Visible only'}`;
  $('pages-count').textContent = `${selectedPages.size} selected`;
  $('page-list').querySelectorAll<HTMLInputElement>('input').forEach(input => input.disabled = busy());
  primary.disabled = false; secondary.hidden = true;
  if (busy()) { primary.innerHTML = stopping ? 'Stopping…' : `${icons.close} Cancel ${mode === 'plan' ? 'review' : 'operation'}`; primary.disabled = stopping; }
  else if (mode === 'inventory') {
    primary.innerHTML = stale ? `${icons.refresh} Refresh inventory` : `Review ${mappings.size} mappings ${icons.arrow}`;
    primary.disabled = !stale && (!mappings.size || !fontsReady || [...mappings.values()].some(invalidTarget));
    secondary.innerHTML = `${icons.refresh} Refresh`; secondary.hidden = stale;
  } else if (mode === 'review') { primary.innerHTML = `Replace ${num(review?.layers || 0)} layers ${icons.arrow}`; secondary.textContent = 'Back'; secondary.hidden = false; }
  else {
    primary.innerHTML = mode === 'result' ? `${icons.refresh} Scan again` : `Scan ${options.scope === 'selection' ? 'selection' : options.scope === 'page' ? 'current page' : options.scope === 'pages' ? 'selected pages' : 'entire file'} ${icons.arrow}`;
    primary.disabled = !initialized || (options.scope === 'selection' && !selected) || (options.scope === 'pages' && !selectedPages.size);
  }
  if (startupFailed && !initialized && !busy()) { primary.textContent = 'Retry connection ↻'; primary.disabled = false; }
  if (!initialized && !startupFailed && !busy()) { primary.textContent = 'Connecting to Figma…'; primary.disabled = true; }
}
function render() {
  updateControls();
  if (mode === 'empty') workspace.innerHTML = `<div class="empty"><div class="type-demo" aria-hidden="true"><span class="type-before">Aa</span><span class="type-arrow">${icons.arrow}</span><span class="type-after">Aa</span></div><h2>A fresh face for your file.</h2><p>Scan your typography, choose replacements, and review every mapping before you make the switch.</p><div class="feature-line"><span>Mixed-font aware</span><span>Local & private</span></div></div>`;
  else if (busy()) workspace.innerHTML = `<div class="progress-view"><div class="spinner" aria-hidden="true"></div><h2 id="progress-title">${mode === 'scan' ? 'Reading your typography' : mode === 'plan' ? 'Preparing your review' : 'Making the switch'}</h2><p id="progress-detail">${mode === 'scan' ? 'Only your chosen scope will be scanned.' : mode === 'plan' ? 'Planning only the affected font ranges.' : 'Checking destination fonts before any edits.'}</p><div id="progress-track" class="progress-track indeterminate" role="progressbar" aria-label="Operation progress"><span id="progress-fill"></span></div><p>${mode === 'apply' ? 'Cancel stops future writes. Completed edits remain.' : 'Cancel at any time. No text is being changed.'}</p></div>`;
  else if (mode === 'inventory' && inventory) renderInventory();
  else if (mode === 'review' && review) renderReview(review);
  else if (mode === 'result' && result) renderResult(result);
}
function stats(items: [number, string][]) { return `<div class="stats">${items.map(([value, label]) => `<div class="stat"><strong>${num(value)}</strong><span>${label}</span></div>`).join('')}</div>`; }
function renderPages() {
  $('page-list').innerHTML = pageChoices.map((page, i) => `<label><input type="checkbox" data-page="${i}" ${selectedPages.has(page.id) ? 'checked' : ''}>${esc(page.name)}</label>`).join('');
  $('page-list').querySelectorAll<HTMLInputElement>('input').forEach(input => input.onchange = () => { const page = pageChoices[Number(input.dataset.page)]; if (input.checked) selectedPages.add(page.id); else selectedPages.delete(page.id); optionsChanged(); });
}
function skippedMarkup(inv: Inventory) {
  const skipped = Object.entries(inv.skipped), excluded = Object.entries(inv.excludedContainers || {});
  if (!skipped.length && !excluded.length) return '';
  return `<details class="skipped-details"><summary>${num(skipped.reduce((s, [, n]) => s + n, 0))} text layers skipped${excluded.length ? ` · ${num(excluded.reduce((s, [, n]) => s + n, 0))} containers excluded` : ''}</summary><ul>${skipped.map(([why, count]) => `<li>${esc(why)}: ${num(count)} text layers</li>`).join('')}${excluded.map(([why, count]) => `<li>${esc(why)}: ${num(count)} containers; text count not inspected</li>`).join('')}</ul></details>`;
}
function renderInventory() {
  const inv = inventory!;
  if (!inv.fonts.length) {
    workspace.innerHTML = `<div class="empty"><h2>No eligible text found.</h2><p>Try another scope or include more content in scan options. Outlined text and images cannot be replaced as fonts.</p>${inv.options.onlyNodeIds ? '<button id="clear-retry" class="text-button">Scan the full scope</button>' : ''}</div>${skippedMarkup(inv)}`;
    $('clear-retry')?.addEventListener('click', clearRetry); return;
  }
  workspace.innerHTML = `<div class="workspace-heading"><div><h2>Font inventory <span class="pill">${new Set(inv.fonts.map(f => f.font.family)).size} families</span></h2><p>${num(inv.layers)} text layers · ${esc(inv.pageName)}</p></div><button id="map-all" class="text-button" ${fontsReady ? '' : 'disabled'}>Map all…</button></div><div class="inventory-tools"><label class="search">${icons.search}<input id="inventory-search" placeholder="Filter source fonts or axis values…" aria-label="Filter source fonts" value="${esc(query)}"></label><button id="density" class="density" aria-pressed="${compact}">${compact ? 'Compact' : 'Comfortable'}</button></div><div id="filters" class="filters" role="group" aria-label="Mapping filters"></div><div class="table-labels"><span>SOURCE STYLE</span><span></span><span>DESTINATION</span></div><div id="font-rows" class="${compact ? 'compact' : ''}"></div>${skippedMarkup(inv)}<p class="timing">Scanned in ${elapsed(inv.duration)} · ${num(inv.ranges)} source ranges${!fontsReady ? ' · Destination fonts still loading' : ''}</p>`;
  $('map-all').onclick = () => openPicker();
  if (inv.options.onlyNodeIds) {
    workspace.insertAdjacentHTML('afterbegin', '<button id="clear-retry" class="text-button">Return to the full scope</button>');
    $('clear-retry').onclick = clearRetry;
  }
  $('inventory-search').oninput = e => { query = (e.target as HTMLInputElement).value; rowLimit = 80; renderRows(); };
  $('density').onclick = () => { compact = !compact; $('density').textContent = compact ? 'Compact' : 'Comfortable'; $('density').setAttribute('aria-pressed', String(compact)); $('font-rows').className = compact ? 'compact' : ''; };
  renderFilters(); renderRows();
}
function renderFilters() {
  const rows = inventory!.fonts;
  const counts = { all: rows.length, mapped: rows.filter(r => mappings.has(r.key)).length, unmapped: rows.filter(r => !mappings.has(r.key)).length, attention: rows.filter(attention).length };
  $('filters').innerHTML = (['all', 'mapped', 'unmapped', 'attention'] as Filter[]).map(f => `<button data-filter="${f}" aria-pressed="${filter === f}">${f === 'attention' ? 'Attention' : f[0].toUpperCase() + f.slice(1)} ${counts[f]}</button>`).join('');
  $('filters').querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => { filter = b.dataset.filter as Filter; rowLimit = 80; renderFilters(); renderRows(); $('filters').querySelector<HTMLButtonElement>(`[data-filter="${filter}"]`)?.focus(); });
}
function renderRows(restoreKey?: string) {
  const inv = inventory!, search = query.toLowerCase();
  const rows = inv.fonts.filter(r => `${r.font.family} ${r.font.style} ${axisLabel(r.font)}`.toLowerCase().includes(search) && (filter === 'mapped' ? mappings.has(r.key) : filter === 'unmapped' ? !mappings.has(r.key) : filter === 'attention' ? attention(r) : true));
  const indices = new Map(inv.fonts.map((r, i) => [r.key, i])), groups = new Map<string, FontUsage[]>();
  for (const row of rows.slice(0, rowLimit)) { const list = groups.get(row.font.family) || []; list.push(row); groups.set(row.font.family, list); }
  $('font-rows').innerHTML = [...groups].map(([family, styles]) => {
    const groupIndex = indices.get(styles[0].key)!;
    return `<details class="family-group" data-group="${esc(family)}" ${expanded.get(family) !== false ? 'open' : ''}><summary><strong>${esc(family)}</strong><span class="group-count">${styles.length} ${styles.length === 1 ? 'style' : 'styles'}</span><button class="text-button" data-map-family="${groupIndex}" ${fontsReady ? '' : 'disabled'} aria-label="Map ${esc(family)} family">Map family</button></summary>${styles.map(row => {
      const i = indices.get(row.key)!, target = mappings.get(row.key), invalid = target && invalidTarget(target);
      return `<div class="font-row"><div><div class="style-name">${esc(row.font.style)}${row.missing && fontsReady ? '<span class="badge">Unavailable</span>' : ''}</div>${row.font.variationSettings ? `<div class="font-meta axis-values">${esc(axisLabel(row.font))}</div>` : ''}<div class="font-meta">${num(row.layers)} ${row.layers === 1 ? 'layer' : 'layers'}${row.styled ? ' · Styled' : ''}</div><div class="source-actions"><button class="text-button" data-locate="${i}" aria-label="Locate an example of ${esc(row.font.family)} ${esc(row.font.style)}">${icons.locate} Locate</button></div></div><span class="row-arrow">${icons.arrow}</span><button class="target-button ${target ? 'mapped' : ''} ${invalid ? 'invalid' : ''}" data-pick="${i}" ${fontsReady ? '' : 'disabled'} aria-label="Replace ${esc(row.font.family)} ${esc(row.font.style)}"><span>${target ? `<strong>${esc(target.family)}</strong><small>${esc(target.style)}${invalid ? ' · Unavailable' : ''}</small>` : 'Choose font…'}</span>${icons.chevron}</button>${target ? `<div class="row-tail"><span class="match-label">${invalid ? 'Choose another target' : normalizedStyle(target.style) === normalizedStyle(row.font.style) ? target.style === row.font.style ? 'Exact style' : 'Normalized style' : 'Manual style'}</span><button class="text-button" data-clear="${i}" aria-label="Clear ${esc(row.font.family)} ${esc(row.font.style)} mapping">Clear</button></div>` : ''}</div>`;
    }).join('')}</details>`;
  }).join('') || '<p class="no-results">No source styles match this filter.</p>';
  if (rows.length > rowLimit) $('font-rows').insertAdjacentHTML('beforeend', `<div class="more-row"><button id="more-rows" class="text-button">Show next ${Math.min(80, rows.length - rowLimit)} styles (${num(rows.length)} total)</button></div>`);
  $('more-rows')?.addEventListener('click', () => { rowLimit += 80; renderRows(); });
  $('font-rows').querySelectorAll<HTMLDetailsElement>('[data-group]').forEach(group => group.ontoggle = () => expanded.set(group.dataset.group!, group.open));
  $('font-rows').querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b => b.onclick = () => openPicker(inv.fonts[Number(b.dataset.pick)]));
  $('font-rows').querySelectorAll<HTMLButtonElement>('[data-map-family]').forEach(b => b.onclick = event => { event.preventDefault(); event.stopPropagation(); openPicker(undefined, inv.fonts[Number(b.dataset.mapFamily)].font.family); });
  $('font-rows').querySelectorAll<HTMLButtonElement>('[data-clear]').forEach(b => b.onclick = () => { const row = inv.fonts[Number(b.dataset.clear)]; mappings.delete(row.key); renderFilters(); renderRows(row.key); updateControls(); });
  $('font-rows').querySelectorAll<HTMLButtonElement>('[data-locate]').forEach(b => b.onclick = () => { const id = inv.fonts[Number(b.dataset.locate)].sampleId; if (id) send({ type: 'FOCUS', id, requestId: `navigation-${++serial}` }); });
  if (restoreKey) {
    const button = $('font-rows').querySelector<HTMLButtonElement>(`[data-pick="${indices.get(restoreKey)}"]`);
    const group = button?.closest<HTMLDetailsElement>('.family-group');
    if (group && !group.open) group.querySelector<HTMLButtonElement>('[data-map-family]')?.focus(); else button?.focus();
  }
}
function renderReview(r: Review) {
  const sourceMap = new Map(inventory!.fonts.map(f => [f.key, f.font]));
  workspace.innerHTML = `<div class="review-card"><div class="review-top"><p class="eyebrow">REVIEW YOUR CHANGES</p><h2>Ready for a new look.</h2><p>${r.mappedStyles} source styles mapped · ${r.unmappedStyles} styles left unchanged</p></div>${stats([[r.layers, 'text layers'], [r.ranges, 'range writes'], [r.fontsToLoad, 'target fonts']])}<div class="mapping-summary"><p class="eyebrow">SOURCE → DESTINATION</p>${r.mappings.map(m => { const source = sourceMap.get(m.source)!; return `<div class="mapping-line"><span>${esc(source.family)}<small>${esc(source.style)}${source.variationSettings ? `<br>${esc(axisLabel(source))}` : ''}</small></span>${icons.arrow}<span>${esc(m.target.family)}<small>${esc(m.target.style)}</small></span></div>`; }).join('')}</div><div class="review-notes"><p><strong>Scope:</strong> ${esc(inventory!.pageName)} · ${inventory!.options.scope === 'selection' ? 'Original scanned selection' : 'Original scanned pages'}</p><p>Replacements use original sources, so A → B and B → C do not cascade. Text stays unchanged; font metrics may affect layout.</p>${r.styledLayers ? `<p><strong>${num(r.styledLayers)} styled layers:</strong> font changes may create overrides. Style definitions are not migrated.</p>` : ''}${r.variableRanges ? `<p><strong>${num(r.variableRanges)} variable ranges:</strong> custom axes reset to the selected named destination style.</p>` : ''}${inventory!.options.includeComponents ? '<p><strong>Main components included:</strong> edits may propagate beyond this scope.</p>' : ''}${inventory!.options.includeInstances ? '<p><strong>Instances included:</strong> font overrides may be created.</p>' : ''}<p>Changed or moved layers are revalidated before writes. Cancel leaves completed edits in place.</p></div></div>`;
}
function renderResult(r: Result) {
  const partial = r.cancelled || r.failedLayers > 0 || r.skippedLayers > 0;
  workspace.innerHTML = `<div class="review-card"><div class="result-heading"><div class="success-icon">${partial ? icons.arrow : icons.check}</div><p class="eyebrow">${r.cancelled ? 'OPERATION STOPPED' : partial ? 'COMPLETED WITH NOTES' : 'FONT SWAP COMPLETE'}</p><h2>${r.cancelled ? 'Stopped at a safe boundary.' : r.changedLayers ? 'A new look, applied.' : 'No layers were changed.'}</h2><p>${num(r.processedLayers)} of ${num(r.plannedLayers)} planned layers processed · ${elapsed(r.duration)}</p></div>${stats([[r.changedLayers, 'layers changed'], [r.failedLayers + r.skippedLayers, 'layers with notes'], [r.remainingLayers, 'not processed']])}<div class="result-note">${num(r.changedRanges)} writes completed · ${num(r.verifiedRanges)} verified · ${num(r.verificationFailures)} verification failures.<br>${num(r.skippedLayers)} layers skipped · ${num(r.failedLayers)} layers with errors.<br>Native Figma Undo reverts completed edits.${r.warning ? `<p>${esc(r.warning)}</p>` : ''}</div></div><div class="result-actions"><button id="export-report" class="text-button">${icons.download} Export report</button>${r.issues.length || r.cancelled ? '<button id="retry-issues" class="text-button">Refresh to review remaining work</button>' : ''}</div><details class="skipped-details"><summary>Stage timings</summary><ul>${Object.entries(r.timings).map(([stage, ms]) => `<li>${esc(stage)}: ${elapsed(ms!)}</li>`).join('')}</ul><p>Scan and plan timings describe preparation before this Apply.</p></details>${r.issues.length ? '<div class="issues"><label for="issue-filter" class="section-label">OPERATION NOTES</label><select id="issue-filter"><option value="all">All notes</option><option value="failed">Write errors</option><option value="skipped">Skipped layers</option><option value="verification">Verification failures</option></select><div id="issue-list"></div></div>' : ''}`;
  $('export-report').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: VERSION, result: r }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'font-replacer-report.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('retry-issues')?.addEventListener('click', () => {
    options.onlyNodeIds = result?.retryNodeIds;
    startScan();
  });
  if (r.issues.length) { $<HTMLSelectElement>('issue-filter').value = issueFilter; $('issue-filter').onchange = e => { issueFilter = (e.target as HTMLSelectElement).value; issueLimit = 60; renderIssues(); }; renderIssues(); }
}
function renderIssues() {
  const issues = result!.issues.filter(i => issueFilter === 'all' || i.kind === issueFilter);
  $('issue-list').innerHTML = issues.slice(0, issueLimit).map(issue => `<div class="issue"><div><strong>${esc(issue.name)}</strong><p>${esc(issue.reason)}</p></div><button class="text-button" data-focus="${result!.issues.indexOf(issue)}" aria-label="Locate ${esc(issue.name)}">${icons.locate}</button></div>`).join('') || '<p class="no-results">No notes in this category.</p>';
  if (issues.length > issueLimit) $('issue-list').insertAdjacentHTML('beforeend', '<button id="more-issues" class="text-button">Show more notes</button>');
  $('more-issues')?.addEventListener('click', () => { issueLimit += 60; renderIssues(); });
  $('issue-list').querySelectorAll<HTMLButtonElement>('[data-focus]').forEach(b => b.onclick = () => send({ type: 'FOCUS', id: result!.issues[Number(b.dataset.focus)].id, requestId: `navigation-${++serial}` }));
}
function openPicker(source?: FontUsage, sourceFamily?: string) {
  pickerOpener = document.activeElement as HTMLElement; pickerSource = source; pickerScope = sourceFamily;
  const target = source ? mappings.get(source.key) : undefined; pickerFamily = target?.family || ''; pickerStyle = target?.style || ''; pickerLimit = 80;
  $('picker-title').textContent = source ? `${source.font.family} · ${source.font.style}` : sourceFamily ? `Map ${sourceFamily} family` : 'Map all source families';
  $<HTMLInputElement>('font-search').value = '';
  $('choose-font').textContent = source ? 'Use font' : 'Map matching styles';
  renderFamilies(); renderStyles(); renderRecents(); picker.showModal(); $<HTMLInputElement>('font-search').focus();
}
function closePicker() { picker.close(); pickerOpener?.focus(); }
function renderRecents() {
  $('recent-fonts').innerHTML = recents.length ? `Recent: ${recents.filter(name => families.has(name)).map(name => `<button data-recent="${esc(name)}">${esc(name)}</button>`).join('')}` : '';
  $('recent-fonts').querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => selectFamily(b.dataset.recent!));
}
function selectFamily(name: string) { pickerFamily = name; pickerStyle = ''; renderFamilies(); renderStyles(); }
function renderFamilies() {
  const search = $<HTMLInputElement>('font-search').value.toLowerCase(), names = [...families.keys()].filter(n => n.toLowerCase().includes(search));
  $('family-list').innerHTML = names.slice(0, pickerLimit).map((name, i) => `<button data-family="${esc(name)}" role="radio" aria-checked="${name === pickerFamily}" tabindex="${name === pickerFamily || (!pickerFamily && i === 0) ? 0 : -1}">${esc(name)}</button>`).join('') || '<p class="no-results">No available families.</p>';
  if (names.length > pickerLimit) $('family-list').insertAdjacentHTML('beforeend', `<button id="more-families" class="text-button">Show next ${Math.min(80, names.length - pickerLimit)} of ${num(names.length)}</button>`);
  $('more-families')?.addEventListener('click', () => { pickerLimit += 80; renderFamilies(); });
  $('family-list').querySelectorAll<HTMLButtonElement>('[data-family]').forEach(b => b.onclick = () => { selectFamily(b.dataset.family!); focusChoice('family-list', 'family', pickerFamily); });
}
function focusChoice(id: string, data: 'family' | 'style', value: string) { $(id).querySelectorAll<HTMLButtonElement>(`[data-${data}]`).forEach(b => { if (b.dataset[data] === value) { b.focus(); b.scrollIntoView({ block: 'nearest' }); } }); }
function renderStyles() {
  const styles = families.get(pickerFamily) || [];
  if (!pickerSource) $('style-list').innerHTML = `<p class="no-results">${pickerFamily ? `${styles.length} styles available.<br><br>Exact and spacing-normalized matches only. Unmatched styles keep their existing mapping.` : 'Choose a destination family.'}</p>`;
  else {
    if (!pickerStyle && pickerFamily) pickerStyle = matchStyle(pickerSource.font, styles)?.style || '';
    $('style-list').innerHTML = styles.map((f, i) => `<button data-style="${esc(f.style)}" role="radio" aria-checked="${f.style === pickerStyle}" tabindex="${f.style === pickerStyle || (!pickerStyle && i === 0) ? 0 : -1}">${esc(f.style)}</button>`).join('') || '<p class="no-results">Choose a family to see its styles.</p>';
    $('style-list').querySelectorAll<HTMLButtonElement>('[data-style]').forEach(b => b.onclick = () => { pickerStyle = b.dataset.style!; renderStyles(); focusChoice('style-list', 'style', pickerStyle); });
  }
  $<HTMLButtonElement>('choose-font').disabled = !pickerFamily || (!!pickerSource && !pickerStyle);
  $('picker-note').textContent = pickerSource ? 'Names are shown in the interface font, not as a typeface preview.' : pickerScope ? `Only source styles in ${pickerScope} will be mapped.` : 'This action maps every source family in the inventory. Review the results before replacing.';
}
$('choose-font').onclick = () => {
  const targets = families.get(pickerFamily) || []; let unresolved = 0;
  if (pickerSource) {
    const target = targets.find(f => f.style === pickerStyle);
    if (target) { if (fontKey(target) === pickerSource.key) mappings.delete(pickerSource.key); else mappings.set(pickerSource.key, target); }
  } else for (const row of inventory!.fonts.filter(r => !pickerScope || r.font.family === pickerScope)) {
    const target = matchStyle(row.font, targets);
    if (!target) { unresolved++; continue; }
    if (fontKey(target) === row.key) mappings.delete(row.key); else mappings.set(row.key, target);
  }
  recents = [pickerFamily, ...recents.filter(f => f !== pickerFamily)].slice(0, 8); send({ type: 'SAVE_RECENTS', families: recents });
  notice(unresolved ? `${unresolved} styles need a manual match. Existing mappings were kept for those styles.` : 'Mapping updated. Review the destinations before replacing.');
  const focusKey = pickerSource?.key || inventory?.fonts.find(f => f.font.family === pickerScope)?.key;
  closePicker(); review = undefined; renderFilters(); renderRows(focusKey); updateControls();
};
$('font-search').oninput = () => { pickerLimit = 80; renderFamilies(); };
$('font-search').onkeydown = event => { if (event.key === 'ArrowDown') { event.preventDefault(); $('family-list').querySelector<HTMLButtonElement>('[data-family]')?.focus(); } };
for (const [id, data] of [['family-list', 'family'], ['style-list', 'style']] as const) $(id).onkeydown = event => {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']; if (!keys.includes(event.key)) return;
  const buttons = [...$(id).querySelectorAll<HTMLButtonElement>(`[data-${data}]`)];
  let index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
  const button = buttons[index]; if (button) { event.preventDefault(); button.click(); }
};
$('close-picker').onclick = closePicker;
$('refresh-fonts').onclick = () => { $('picker-note').textContent = 'Refreshing Figma’s font catalog…'; send({ type: 'REFRESH_FONTS', requestId: `catalog-${++serial}` }); };
$('help').innerHTML = icons.help; $('close-picker').innerHTML = icons.close; $('close-help').innerHTML = icons.close; $('picker-search-icon').innerHTML = icons.search;
$('help').onclick = () => $<HTMLDialogElement>('help-dialog').showModal(); $('close-help').onclick = () => $<HTMLDialogElement>('help-dialog').close();
$('retry-fonts').onclick = () => { send({ type: 'REFRESH_FONTS', requestId: `catalog-${++serial}` }); $<HTMLDialogElement>('help-dialog').close(); notice('Refreshing available destination fonts…'); };
$('version').textContent = `v${VERSION}`; $('help-version').textContent = `${VERSION} · Development build`;
const scopeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-scope]')];
scopeButtons.forEach((button, i) => {
  button.onclick = () => { options.scope = button.dataset.scope as Scope; optionsChanged(); };
  button.onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? scopeButtons.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : scopeButtons.length - 1)) % scopeButtons.length; scopeButtons[next].click(); scopeButtons[next].focus(); };
});
for (const key of ['includeHidden', 'includeLocked', 'includeInstances', 'includeComponents', 'fastScan'] as const) $<HTMLInputElement>(key).onchange = e => { options[key] = (e.target as HTMLInputElement).checked; optionsChanged(); };
function startScan() { notice(); stale = true; review = undefined; options.pageIds = [...selectedPages]; request({ type: 'SCAN', options: { ...options } }, 'scan'); }
function clearRetry() { delete options.onlyNodeIds; startScan(); }
primary.onclick = () => {
  if (startupFailed && !initialized) connect();
  else if (busy()) { stopping = true; send({ type: 'CANCEL' }); updateControls(); }
  else if (mode === 'inventory' && inventory && !stale) request({ type: 'PLAN', inventoryId: inventory.id, mappings: [...mappings].map(([source, target]) => ({ source, target })) }, 'plan');
  else if (mode === 'review' && review) { notice(); request({ type: 'APPLY', planId: review.id }, 'apply'); }
  else { if (mode === 'result') delete options.onlyNodeIds; startScan(); }
};
secondary.onclick = () => mode === 'review' ? setMode('inventory') : startScan();
window.onmessage = (event: MessageEvent) => {
  const message: unknown = event.data?.pluginMessage; if (!isResponse(message)) return;
  const correlated = ['BUSY', 'PROGRESS', 'INVENTORY', 'REVIEW', 'RESULT', 'CANCELLED'].includes(message.type) || (message.type === 'ERROR' && message.area === 'operation');
  if (correlated && message.requestId && message.requestId !== activeRequest) return;
  switch (message.type) {
    case 'CONTEXT':
      selected = message.selected; $('selection-count').textContent = String(selected); $('context').textContent = message.pageName;
      if (message.pages) { pageChoices = message.pages; const ids = new Set(pageChoices.map(p => p.id)); selectedPages = new Set([...selectedPages].filter(id => ids.has(id))); renderPages(); }
      if (!initialized) { options.scope = selected ? 'selection' : 'page'; initialized = true; }
      if (startupFailed && !fontsReady) notice('Connected to Figma. Destination fonts are still loading. You can scan now.');
      updateControls(); break;
    case 'FONTS':
      if (startupTimer !== undefined) clearTimeout(startupTimer); fontsReady = true; startupFailed = false; catalog = message.fonts; families = new Map(); available = new Set();
      for (const font of catalog) { const list = families.get(font.family) || []; if (!list.some(f => f.style === font.style)) list.push(font); families.set(font.family, list); available.add(loadKey(font)); }
      if (inventory) for (const row of inventory.fonts) row.missing = !available.has(loadKey(row.font));
      if (mode === 'inventory') renderInventory(); else updateControls();
      if (picker.open) { if (!families.has(pickerFamily)) { pickerFamily = ''; pickerStyle = ''; } renderFamilies(); renderStyles(); renderRecents(); }
      break;
    case 'RECENTS': recents = message.families.slice(0, 8); if (picker.open) renderRecents(); break;
    case 'BUSY': if (mode !== message.operation) setMode(message.operation); break;
    case 'PROGRESS':
      if (!busy()) break;
      $('progress-title').textContent = message.stage; $('progress-detail').textContent = message.total ? `${num(message.done)} of ${num(message.total)}` : `${num(message.done)} text layers checked`;
      $('progress-track').classList.toggle('indeterminate', !message.total);
      if (message.total) { $('progress-fill').style.width = `${Math.min(100, message.done / message.total * 100)}%`; $('progress-track').setAttribute('aria-valuenow', String(message.done)); $('progress-track').setAttribute('aria-valuemax', String(message.total)); }
      else { $('progress-track').removeAttribute('aria-valuenow'); $('progress-track').removeAttribute('aria-valuemax'); }
      announce(message.stage); break;
    case 'INVENTORY': {
      const oldSize = mappings.size; inventory = message.inventory; options = { ...inventory.options }; stale = false; review = undefined;
      const sources = new Set(inventory.fonts.map(f => f.key)); mappings = new Map([...mappings].filter(([key]) => sources.has(key))); rowLimit = 80;
      setMode('inventory'); announce(`Scan complete. ${inventory.layers} text layers.`);
      if (oldSize) notice(`${mappings.size} existing mappings kept${oldSize > mappings.size ? `; ${oldSize - mappings.size} obsolete sources removed` : ''}. Destinations are checked before review.`);
      break;
    }
    case 'REVIEW': if (inventory?.id !== message.review.inventoryId) return; review = message.review; setMode('review'); announce('Review ready.'); break;
    case 'RESULT': result = message.result; issueLimit = 60; issueFilter = 'all'; setMode('result'); announce(`${result.changedLayers} layers changed. ${result.remainingLayers} not processed.`); break;
    case 'CANCELLED': setMode(inventory ? 'inventory' : 'empty'); notice(message.operation === 'plan' ? 'Review cancelled. Your mappings are kept.' : 'Scan cancelled. Your previous mappings are kept. No text changed.'); break;
    case 'INVALIDATED': if (inventory && !busy() && mode !== 'result') { stale = true; review = undefined; notice(message.reason); setMode('inventory'); } break;
    case 'ERROR':
      if (!fontsReady && (message.area === 'startup' || !message.area)) { startupFailed = true; if (startupTimer !== undefined) clearTimeout(startupTimer); }
      if (message.area === 'operation' || (!message.area && busy())) {
        if (mode === 'apply') { stale = true; review = undefined; }
        if (/refresh|expired/i.test(message.message)) stale = true;
        setMode(inventory ? 'inventory' : 'empty');
      } else updateControls();
      notice(message.message, true); break;
  }
};
function connect() {
  if (startupTimer !== undefined) clearTimeout(startupTimer); startupFailed = false; startupRetries = 0; notice(); updateControls(); const started = Date.now();
  const check = () => {
    if (fontsReady || startupFailed) return;
    if (Date.now() - started >= 25000) { startupFailed = true; notice(initialized ? 'Figma’s destination fonts are unavailable. Use Refresh fonts in the picker or reopen the plugin. Your scan can still run.' : 'The plugin could not connect to Figma. Retry, or close and reopen the development plugin.', true); updateControls(); return; }
    if (!initialized && startupRetries < 5) { startupRetries++; send({ type: 'INIT' }); }
    startupTimer = setTimeout(check, 1000);
  };
  startupTimer = setTimeout(check, 1000); send({ type: 'INIT' });
}
$('resize').onpointerdown = event => {
  const x = event.screenX, y = event.screenY, width = window.innerWidth, height = window.innerHeight, handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId); handle.onpointermove = e => send({ type: 'RESIZE', width: width + e.screenX - x, height: height + e.screenY - y });
  handle.onpointerup = handle.onpointercancel = () => { handle.onpointermove = null; };
};
$('resize').onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const step = event.shiftKey ? 40 : 10; send({ type: 'RESIZE', width: window.innerWidth + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), height: window.innerHeight + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) }); };
console.info(`[Font Replacer Pro ${VERSION}] UI ready`);
render(); connect();
