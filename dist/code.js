"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // src/shared.ts
  function fontKey(font) {
    return JSON.stringify([font.family, font.style, Object.entries(font.variationSettings || {}).sort(([a], [b]) => a.localeCompare(b))]);
  }
  function loadKey(font) {
    return JSON.stringify([font.family, font.style]);
  }
  var record = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  var strings = (x) => Array.isArray(x) && x.every((v) => typeof v === "string");
  function isFont(value) {
    if (!record(value)) return false;
    return typeof value.family === "string" && value.family.length > 0 && value.family.length < 512 && typeof value.style === "string" && value.style.length > 0 && value.style.length < 512 && (value.variationSettings === void 0 || record(value.variationSettings) && Object.entries(value.variationSettings).every(([k, v]) => /^[a-zA-Z0-9 ]{4}$/.test(k) && typeof v === "number" && Number.isFinite(v)));
  }
  function isOptions(o) {
    return record(o) && ["selection", "page", "pages", "document"].includes(o.scope) && ["includeHidden", "includeLocked", "includeInstances", "includeComponents"].every((k) => typeof o[k] === "boolean") && (o.fastScan === void 0 || typeof o.fastScan === "boolean") && (o.pageIds === void 0 || strings(o.pageIds) && o.pageIds.length < 1e4) && (o.onlyNodeIds === void 0 || strings(o.onlyNodeIds));
  }
  function isRequest(r) {
    if (!record(r) || r.requestId !== void 0 && (typeof r.requestId !== "string" || r.requestId.length > 160)) return false;
    switch (r.type) {
      case "INIT":
      case "REFRESH_FONTS":
      case "CANCEL":
        return true;
      case "SAVE_RECENTS":
        return strings(r.families) && r.families.length <= 12;
      case "FOCUS":
        return typeof r.id === "string" && r.id.length < 256;
      case "RESIZE":
        return Number.isFinite(r.width) && Number.isFinite(r.height);
      case "APPLY":
        return typeof r.planId === "string";
      case "PLAN":
        return typeof r.inventoryId === "string" && Array.isArray(r.mappings) && r.mappings.length < 1e4 && r.mappings.every((m) => record(m) && typeof m.source === "string" && isFont(m.target));
      case "SCAN":
        return isOptions(r.options);
      default:
        return false;
    }
  }

  // src/operations.ts
  var Cancelled = class extends Error {
    constructor() {
      super("Operation cancelled");
    }
  };
  async function bounded(promise, token, timeoutMs, label) {
    if (token.cancelled) {
      void promise.catch(() => {
      });
      throw new Cancelled();
    }
    let timeout;
    let poll;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out. Retry after checking Figma and font availability.`)), timeoutMs);
        const check = () => {
          if (token.cancelled) reject(new Cancelled());
          else poll = setTimeout(check, 25);
        };
        check();
      })]);
    } finally {
      if (timeout !== void 0) clearTimeout(timeout);
      if (poll !== void 0) clearTimeout(poll);
    }
  }
  var pause = () => new Promise((resolve) => setTimeout(resolve, 0));

  // src/engine.ts
  var textError = (e) => e instanceof Error ? e.message : String(e);
  var copyFont = (f) => __spreadValues({ family: f.family, style: f.style }, f.variationSettings ? { variationSettings: __spreadValues({}, f.variationSettings) } : {});
  var bindingKey = (bindings) => JSON.stringify(Object.entries(bindings || {}).sort(([a], [b]) => a.localeCompare(b)));
  function hasFontBinding(value) {
    const bindings = value;
    return !!bindings && ["fontFamily", "fontStyle", "fontWeight"].some((k) => bindings[k] !== void 0);
  }
  function ownPolicy(node, o) {
    if ("locked" in node && node.locked && !o.includeLocked) return "Locked layer or ancestor";
    if ("visible" in node && !node.visible && !o.includeHidden) return "Hidden layer or ancestor";
    if (node.type === "INSTANCE" && !o.includeInstances) return "Instance text";
    if ((node.type === "COMPONENT" || node.type === "COMPONENT_SET") && !o.includeComponents) return "Main component text";
  }
  function policyReason(node, o) {
    let current = node;
    while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
      const reason = ownPolicy(current, o);
      if (reason) return reason;
      current = current.parent;
    }
  }
  function normalizeRoots(nodes) {
    const ids = new Set(nodes.map((n) => n.id)), seen = /* @__PURE__ */ new Set();
    return nodes.filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      let p = node.parent;
      while (p && p.type !== "PAGE" && p.type !== "DOCUMENT") {
        if (ids.has(p.id)) return false;
        p = p.parent;
      }
      return true;
    });
  }
  function takeSnapshot(node) {
    const characters = node.characters;
    if (hasFontBinding(node.boundVariables)) throw new Error("Font variable binding");
    const segments = [];
    if (!characters.length) {
      if (node.fontName === figma.mixed) throw new Error("Empty text has no uniform font");
      const font = copyFont(node.fontName);
      segments.push({ start: 0, end: 0, font, key: fontKey(font), styleId: typeof node.textStyleId === "string" ? node.textStyleId : "", bindings: bindingKey(node.boundVariables) });
    } else {
      for (const s of node.getStyledTextSegments(["fontName", "textStyleId", "boundVariables"])) {
        if (hasFontBinding(s.boundVariables)) throw new Error("Font variable binding");
        const font = copyFont(s.fontName);
        segments.push({ start: s.start, end: s.end, font, key: fontKey(font), styleId: s.textStyleId, bindings: bindingKey(s.boundVariables) });
      }
    }
    return { id: node.id, name: node.name, characters, segments };
  }
  function sameSnapshot(a, b) {
    return a.characters === b.characters && a.segments.length === b.segments.length && a.segments.every((s, i) => {
      const t = b.segments[i];
      return s.start === t.start && s.end === t.end && s.key === t.key && s.styleId === t.styleId && s.bindings === t.bindings;
    });
  }
  function compileActions(snapshot, mappings) {
    const actions = [];
    let prior;
    for (const s of snapshot.segments) {
      const target = mappings.get(s.key);
      if (target && fontKey(target) !== s.key) {
        const previous = actions[actions.length - 1];
        if (previous && previous.end === s.start && loadKey(previous.target) === loadKey(target) && fontKey(previous.target) === fontKey(target) && (prior == null ? void 0 : prior.styleId) === s.styleId && prior.bindings === s.bindings) previous.end = s.end;
        else actions.push({ start: s.start, end: s.end, target });
      }
      prior = s;
    }
    return actions;
  }
  var FontEngine = class {
    constructor(send2, config = { waitMs: 2e4, sliceMs: 10, progressMs: 80 }) {
      this.send = send2;
      this.config = config;
      this.snapshots = /* @__PURE__ */ new Map();
      this.bySource = /* @__PURE__ */ new Map();
      this.serial = 0;
      this.token = { cancelled: false };
      this.loads = /* @__PURE__ */ new Map();
      this.catalog = /* @__PURE__ */ new Set();
      this.busy = false;
      this.lastProgress = 0;
      this.dirty = false;
      this.scanDuration = 0;
      this.scopePages = /* @__PURE__ */ new Set();
      this.scopeRoots = /* @__PURE__ */ new Set();
      this.styleIds = /* @__PURE__ */ new Set();
    }
    get isBusy() {
      return this.busy;
    }
    cancel() {
      this.token.cancelled = true;
    }
    setCatalog(fonts2) {
      this.catalog = new Set(fonts2.map(loadKey));
    }
    /** Invalidation preserves source rules in the UI; refresh is required before review. */
    invalidate(reason) {
      if (this.busy) return;
      this.dirty = true;
      this.plan = void 0;
      this.send({ type: "INVALIDATED", reason });
    }
    usesStyle(ids) {
      return [...ids].some((id) => this.styleIds.has(id));
    }
    isScopePage(id) {
      return !!this.inventory && this.scopePages.has(id);
    }
    begin(operation) {
      if (this.busy) throw new Error("Wait for the current operation to finish.");
      this.busy = true;
      this.token = { cancelled: false };
      this.lastProgress = 0;
      this.send({ type: "BUSY", operation });
    }
    progress(stage, done, total, force = false) {
      if (force || Date.now() - this.lastProgress >= this.config.progressMs) {
        this.lastProgress = Date.now();
        this.send({ type: "PROGRESS", stage, done, total });
      }
    }
    clearInventory() {
      this.inventory = void 0;
      this.snapshots.clear();
      this.bySource.clear();
      this.styleIds.clear();
    }
    async scan(options) {
      this.begin("scan");
      this.plan = void 0;
      this.clearInventory();
      this.dirty = false;
      const token = this.token, start = Date.now();
      const skipped = {}, excludedContainers = {};
      const usage = /* @__PURE__ */ new Map();
      let scanned = 0;
      const onlyIds = options.onlyNodeIds ? new Set(options.onlyNodeIds) : void 0;
      figma.skipInvisibleInstanceChildren = options.fastScan !== false && !options.includeHidden;
      try {
        const page = figma.currentPage, roots = normalizeRoots(page.selection);
        this.scopeRoots = new Set(roots.map((n) => n.id));
        if (options.scope === "selection" && !roots.length) throw new Error("Select text, frames, or groups in Figma, then scan again.");
        let pages = options.scope === "document" ? [...figma.root.children] : options.scope === "pages" ? figma.root.children.filter((p) => {
          var _a;
          return (_a = options.pageIds) == null ? void 0 : _a.includes(p.id);
        }) : [page];
        if (!pages.length) throw new Error("Choose at least one existing page to scan.");
        if (options.scope === "pages" && new Set(options.pageIds).size !== pages.length) throw new Error("The page selection changed. Choose the pages again.");
        this.scopePages = new Set(pages.map((p) => p.id));
        for (let index = 0; index < pages.length; index++) {
          if (token.cancelled) throw new Cancelled();
          const p = pages[index];
          this.progress(`Loading ${p.name}`, index, pages.length, true);
          await bounded(p.loadAsync(), token, this.config.waitMs, "Page loading");
          const stack = (options.scope === "selection" ? roots : [...p.children]).map((node) => ({ node, inherited: options.scope === "selection" ? policyReason(node, options) : void 0 }));
          let slice = Date.now();
          while (stack.length) {
            if (token.cancelled) throw new Cancelled();
            const { node, inherited } = stack.pop(), reason = inherited || ownPolicy(node, options);
            if (reason && node.type !== "TEXT" && options.fastScan !== false) {
              excludedContainers[reason] = (excludedContainers[reason] || 0) + 1;
            } else {
              if ("children" in node) {
                const children = node.children;
                for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], inherited: reason });
              }
              if (node.type === "TEXT" && (!onlyIds || onlyIds.has(node.id))) {
                scanned++;
                if (reason) skipped[reason] = (skipped[reason] || 0) + 1;
                else {
                  try {
                    const snapshot = takeSnapshot(node), missing = node.hasMissingFont;
                    this.snapshots.set(node.id, snapshot);
                    for (const segment of snapshot.segments) {
                      if (segment.styleId) this.styleIds.add(segment.styleId);
                      let ids = this.bySource.get(segment.key);
                      if (!ids) {
                        ids = /* @__PURE__ */ new Set();
                        this.bySource.set(segment.key, ids);
                      }
                      ids.add(node.id);
                      let row = usage.get(segment.key);
                      if (!row) {
                        row = { key: segment.key, font: segment.font, layers: 0, ranges: 0, missing: false, styled: false, sampleId: node.id };
                        usage.set(segment.key, row);
                      }
                      row.layers = ids.size;
                      row.ranges++;
                      row.missing || (row.missing = missing && !this.catalog.has(loadKey(segment.font)));
                      row.styled || (row.styled = !!segment.styleId);
                    }
                  } catch (e) {
                    const why = textError(e);
                    skipped[why] = (skipped[why] || 0) + 1;
                  }
                }
              }
            }
            if (Date.now() - slice >= this.config.sliceMs) {
              this.progress(`Scanning ${p.name}`, scanned, 0);
              await pause();
              slice = Date.now();
            }
          }
        }
        const fonts2 = [...usage.values()].sort((a, b) => a.font.family.localeCompare(b.font.family) || a.font.style.localeCompare(b.font.style) || a.key.localeCompare(b.key));
        this.scanDuration = Date.now() - start;
        const scopeName = options.scope === "document" ? "Entire file" : options.scope === "pages" ? `${pages.length} selected ${pages.length === 1 ? "page" : "pages"}` : page.name;
        this.inventory = { id: `inventory-${++this.serial}`, options: __spreadProps(__spreadValues({}, options), { pageIds: options.pageIds ? [...options.pageIds] : void 0, onlyNodeIds: options.onlyNodeIds ? [...options.onlyNodeIds] : void 0 }), pageName: onlyIds ? `Remaining work \xB7 ${scopeName}` : scopeName, fonts: fonts2, layers: this.snapshots.size, ranges: fonts2.reduce((s, f) => s + f.ranges, 0), scanned, skipped, excludedContainers, duration: this.scanDuration };
        this.send({ type: "INVENTORY", inventory: this.inventory });
      } catch (e) {
        this.clearInventory();
        if (e instanceof Cancelled) this.send({ type: "CANCELLED", operation: "scan" });
        else throw e;
      } finally {
        this.busy = false;
      }
    }
    async createPlan(inventoryId, input) {
      if (!this.inventory || this.inventory.id !== inventoryId || this.dirty) throw new Error("Refresh the font inventory before reviewing these mappings.");
      this.begin("plan");
      this.plan = void 0;
      const token = this.token, start = Date.now(), inv = this.inventory;
      try {
        const mappings = /* @__PURE__ */ new Map(), affected = /* @__PURE__ */ new Set();
        for (const mapping of input) {
          if (!this.bySource.has(mapping.source)) throw new Error("A source is outside this inventory. Refresh before reviewing.");
          if (!this.catalog.has(loadKey(mapping.target))) throw new Error(`Destination ${mapping.target.family} ${mapping.target.style} is unavailable. Refresh fonts or choose another destination.`);
          if (mappings.has(mapping.source)) throw new Error("Conflicting duplicate source mapping.");
          mappings.set(mapping.source, copyFont(mapping.target));
          if (mapping.source !== fontKey(mapping.target)) for (const id of this.bySource.get(mapping.source)) affected.add(id);
        }
        const nodes = [], targets = /* @__PURE__ */ new Map();
        let ranges = 0, styledLayers = 0, variableRanges = 0, done = 0, slice = Date.now();
        for (const id of affected) {
          if (token.cancelled) throw new Cancelled();
          const snapshot = this.snapshots.get(id), actions = compileActions(snapshot, mappings);
          if (actions.length) {
            nodes.push({ snapshot, actions });
            ranges += actions.length;
            if (snapshot.segments.some((s) => s.styleId)) styledLayers++;
            for (const action of actions) targets.set(loadKey(action.target), action.target);
            for (const s of snapshot.segments) if (s.font.variationSettings && mappings.has(s.key) && fontKey(mappings.get(s.key)) !== s.key) variableRanges++;
          }
          done++;
          if (Date.now() - slice >= this.config.sliceMs) {
            this.progress("Preparing review", done, affected.size);
            await pause();
            slice = Date.now();
          }
        }
        if (!nodes.length) throw new Error("Choose a different destination for at least one source font.");
        const effective = input.filter((m) => m.source !== fontKey(m.target));
        const review = { id: `plan-${++this.serial}`, inventoryId, layers: nodes.length, ranges, fontsToLoad: targets.size, styledLayers, variableRanges, unmappedLayers: this.snapshots.size - nodes.length, mappedStyles: effective.length, unmappedStyles: inv.fonts.length - effective.length, mappings: effective, duration: Date.now() - start };
        this.plan = { review, nodes, targets: [...targets.values()] };
        this.send({ type: "REVIEW", review });
      } catch (e) {
        if (e instanceof Cancelled) this.send({ type: "CANCELLED", operation: "plan" });
        else throw e;
      } finally {
        this.busy = false;
      }
    }
    async load(font, token) {
      const key = loadKey(font);
      let promise = this.loads.get(key);
      if (!promise) {
        promise = figma.loadFontAsync({ family: font.family, style: font.style });
        this.loads.set(key, promise);
      }
      try {
        await bounded(promise, token, this.config.waitMs, `${font.family} ${font.style}`);
      } catch (e) {
        if (this.loads.get(key) === promise) this.loads.delete(key);
        throw e;
      }
    }
    async apply(planId) {
      if (!this.plan || this.plan.review.id !== planId || !this.inventory || this.dirty) throw new Error("This review expired. Refresh and review your mappings again.");
      const plan = this.plan, options = this.inventory.options;
      this.begin("apply");
      this.plan = void 0;
      const token = this.token, start = Date.now();
      const result = { cancelled: false, changedLayers: 0, changedRanges: 0, verifiedRanges: 0, verificationFailures: 0, plannedLayers: plan.nodes.length, processedLayers: 0, remainingLayers: plan.nodes.length, skippedLayers: 0, failedLayers: 0, issues: [], duration: 0, timings: { scan: this.scanDuration, plan: plan.review.duration, load: 0, apply: 0, verification: 0 } };
      let undoOpened = false, fatal;
      const retryIds = new Set(plan.nodes.map((n) => n.snapshot.id));
      try {
        let cursor = 0, loaded = 0;
        const loadStart = Date.now();
        let loadError;
        await Promise.all(Array.from({ length: Math.min(4, plan.targets.length) }, async () => {
          while (cursor < plan.targets.length && !token.cancelled && !loadError) {
            const font = plan.targets[cursor++];
            try {
              await this.load(font, token);
              loaded++;
              this.progress("Loading destination fonts", loaded, plan.targets.length);
            } catch (e) {
              if (!(e instanceof Cancelled)) {
                loadError = e;
                token.cancelled = true;
              }
            }
          }
        }));
        result.timings.load = Date.now() - loadStart;
        if (loadError) throw new Error(`No fonts changed. ${textError(loadError)}`);
        if (token.cancelled) throw new Cancelled();
        let slice = Date.now();
        const applyStart = Date.now();
        for (const { snapshot, actions } of plan.nodes) {
          if (token.cancelled) break;
          let changed = 0;
          try {
            const node = await bounded(figma.getNodeByIdAsync(snapshot.id), token, this.config.waitMs, "Layer lookup");
            if (token.cancelled) throw new Cancelled();
            if (!node || node.type !== "TEXT") throw new SkipError("Layer was removed or is no longer text");
            const reason = policyReason(node, options);
            if (reason) throw new SkipError(reason);
            let p = node;
            while (p && p.type !== "PAGE") p = p.parent;
            if (!p || !this.scopePages.has(p.id)) throw new SkipError("Layer moved outside the scanned pages");
            if (options.scope === "selection") {
              let ancestor = node;
              while (ancestor && !this.scopeRoots.has(ancestor.id)) ancestor = ancestor.parent;
              if (!ancestor) throw new SkipError("Layer moved outside the scanned selection");
            }
            let live;
            try {
              live = takeSnapshot(node);
            } catch (e) {
              throw new SkipError(textError(e));
            }
            if (!sameSnapshot(snapshot, live)) throw new SkipError("Text or font formatting changed after scan");
            if (!undoOpened) {
              figma.commitUndo();
              undoOpened = true;
            }
            for (const action of actions) {
              if (!snapshot.characters.length) node.fontName = action.target;
              else node.setRangeFontName(action.start, action.end, action.target);
              changed++;
              result.changedRanges++;
              const verifyStart = Date.now();
              let verified = false;
              try {
                const assigned = !snapshot.characters.length ? node.fontName : node.getRangeFontName(action.start, action.end);
                verified = assigned !== figma.mixed && assigned.family === action.target.family && assigned.style === action.target.style && Object.entries(action.target.variationSettings || {}).every(([axis, value]) => {
                  var _a;
                  return ((_a = assigned.variationSettings) == null ? void 0 : _a[axis]) === value;
                });
              } catch (e) {
                throw new VerificationError(`Font write completed, but read-back failed: ${textError(e)}`);
              } finally {
                result.timings.verification += Date.now() - verifyStart;
              }
              if (!verified) throw new VerificationError("Font write completed, but the destination could not be verified");
              result.verifiedRanges++;
            }
            retryIds.delete(snapshot.id);
          } catch (e) {
            if (e instanceof Cancelled) break;
            const kind = e instanceof SkipError ? "skipped" : e instanceof VerificationError ? "verification" : "failed";
            if (kind === "verification") result.verificationFailures++;
            if (kind === "skipped") result.skippedLayers++;
            else result.failedLayers++;
            result.issues.push({ id: snapshot.id, name: snapshot.name, reason: textError(e), kind });
          }
          if (changed) result.changedLayers++;
          result.processedLayers++;
          if (Date.now() - slice >= this.config.sliceMs) {
            this.progress("Replacing fonts", result.processedLayers, plan.nodes.length);
            await pause();
            slice = Date.now();
          }
        }
        result.timings.apply = Math.max(0, Date.now() - applyStart - result.timings.verification);
      } catch (e) {
        if (!(e instanceof Cancelled)) fatal = e;
      } finally {
        try {
          if (undoOpened) figma.commitUndo();
        } catch (e) {
          result.warning = `Edits were made, but Figma could not finalize undo history: ${textError(e)}`;
        } finally {
          this.busy = false;
          this.clearInventory();
        }
      }
      if (fatal) throw fatal;
      result.cancelled = token.cancelled;
      result.remainingLayers = result.plannedLayers - result.processedLayers;
      result.duration = Date.now() - start;
      result.retryNodeIds = [...retryIds];
      this.progress("Finished", result.processedLayers, result.plannedLayers, true);
      this.send({ type: "RESULT", result });
    }
  };
  var SkipError = class extends Error {
  };
  var VerificationError = class extends Error {
  };

  // src/version.ts
  var VERSION = true ? "0.2.0" : "development";

  // src/main.ts
  var send = (message) => figma.ui.postMessage(message);
  var operationId;
  var engine = new FontEngine((message) => send(__spreadProps(__spreadValues({}, message), { requestId: operationId })));
  var fonts;
  var fontRequest;
  var context = () => {
    var _a;
    return send({ type: "CONTEXT", selected: figma.currentPage.selection.length, pageName: figma.currentPage.name, pages: ((_a = figma.root) == null ? void 0 : _a.children.map((p) => ({ id: p.id, name: p.name }))) || [] });
  };
  async function loadCatalog(refresh = false) {
    if (fontRequest) return fontRequest;
    if (fonts && !refresh) return;
    fontRequest = (async () => {
      let timer;
      const available = await Promise.race([
        figma.listAvailableFontsAsync(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Figma did not return its font list within 20 seconds. Check the editor, then retry the connection.")), 2e4);
        })
      ]).finally(() => {
        if (timer !== void 0) clearTimeout(timer);
      });
      fonts = available.map((f) => ({ family: f.fontName.family, style: f.fontName.style })).sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style));
      engine.setCatalog(fonts);
    })();
    try {
      await fontRequest;
    } finally {
      fontRequest = void 0;
    }
  }
  async function catalog(refresh = false) {
    await loadCatalog(refresh);
    send({ type: "FONTS", fonts: fonts || [] });
  }
  var subscribed = /* @__PURE__ */ new Set();
  function observeLoadedPages() {
    var _a;
    for (const page of ((_a = figma.root) == null ? void 0 : _a.children) || []) {
      if (subscribed.has(page.id)) continue;
      try {
        page.on("nodechange", (event) => {
          if (engine.isBusy || !engine.isScopePage(page.id)) return;
          const relevant = event.nodeChanges.some((c) => c.type !== "PROPERTY_CHANGE" || c.properties.some((p) => ["characters", "fontName", "textStyleId", "boundVariables", "parent", "visible", "locked"].includes(p)));
          if (relevant) engine.invalidate("Text or scope changed. Refresh to revalidate your saved mappings.");
        });
        subscribed.add(page.id);
      } catch (e) {
      }
    }
  }
  figma.on("selectionchange", context);
  figma.on("currentpagechange", context);
  figma.on("stylechange", (event) => {
    if (!engine.isBusy && engine.usesStyle(new Set(event.styleChanges.map((c) => c.id)))) engine.invalidate("A text style used by this inventory changed. Refresh to keep and revalidate your mappings.");
  });
  figma.ui.onmessage = async (value) => {
    if (!isRequest(value)) {
      send({ type: "ERROR", message: "Invalid plugin request.", area: "navigation" });
      return;
    }
    const requestId = value.requestId;
    const operation = ["SCAN", "PLAN", "APPLY"].includes(value.type);
    try {
      if (operation && engine.isBusy) throw new Error("Wait for the current operation to finish.");
      if (operation) operationId = requestId;
      switch (value.type) {
        case "INIT":
          context();
          await catalog();
          if (figma.clientStorage) {
            try {
              const saved = await figma.clientStorage.getAsync("recent-font-families");
              if (Array.isArray(saved)) send({ type: "RECENTS", families: saved.filter((f) => typeof f === "string").slice(0, 8) });
            } catch (e) {
            }
          }
          break;
        case "REFRESH_FONTS":
          await catalog(true);
          break;
        case "SAVE_RECENTS":
          if (figma.clientStorage) await figma.clientStorage.setAsync("recent-font-families", value.families.slice(0, 8));
          break;
        case "SCAN":
          await engine.scan(value.options);
          observeLoadedPages();
          break;
        case "PLAN":
          await engine.createPlan(value.inventoryId, value.mappings);
          break;
        case "APPLY":
          await engine.apply(value.planId);
          break;
        case "CANCEL":
          engine.cancel();
          break;
        case "FOCUS": {
          if (engine.isBusy) throw new Error("Finish or cancel before navigating.");
          const node = await figma.getNodeByIdAsync(value.id);
          if (!node || !("visible" in node)) throw new Error("This layer is no longer available.");
          let page = node;
          while (page && page.type !== "PAGE") page = page.parent;
          if ((page == null ? void 0 : page.type) === "PAGE") await figma.setCurrentPageAsync(page);
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
          break;
        }
        case "RESIZE":
          figma.ui.resize(Math.max(400, Math.min(900, Math.round(value.width))), Math.max(500, Math.min(1e3, Math.round(value.height))));
          break;
      }
    } catch (e) {
      send({ type: "ERROR", requestId, area: operation ? "operation" : value.type === "INIT" || value.type === "REFRESH_FONTS" ? "startup" : "navigation", message: e instanceof Error ? e.message : String(e) });
    }
  };
  console.info(`[Font Replacer Pro ${VERSION}] Sandbox ready`);
  figma.showUI(__html__, { width: 480, height: 700, themeColors: true });
  context();
  void catalog().catch((e) => send({ type: "ERROR", area: "startup", message: e instanceof Error ? e.message : String(e) }));
})();
