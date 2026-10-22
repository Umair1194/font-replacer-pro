"use strict";
(() => {
  var __defProp = Object.defineProperty;
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
  var __objRest = (source, exclude) => {
    var target = {};
    for (var prop in source)
      if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
        target[prop] = source[prop];
    if (source != null && __getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(source)) {
        if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
          target[prop] = source[prop];
      }
    return target;
  };

  // src/shared.ts
  function fontKey(font) {
    return JSON.stringify([font.family, font.style, Object.entries(font.variationSettings || {}).sort(([a], [b]) => a.localeCompare(b))]);
  }
  function loadKey(font) {
    return JSON.stringify([font.family, font.style]);
  }
  function isFont(value) {
    if (!value || typeof value !== "object") return false;
    const f = value;
    return typeof f.family === "string" && f.family.length > 0 && f.family.length < 512 && typeof f.style === "string" && f.style.length > 0 && f.style.length < 512 && (f.variationSettings === void 0 || typeof f.variationSettings === "object" && f.variationSettings !== null && Object.entries(f.variationSettings).every(([k, v]) => /^[a-zA-Z0-9 ]{4}$/.test(k) && typeof v === "number" && Number.isFinite(v)));
  }
  function isRequest(value) {
    if (!value || typeof value !== "object") return false;
    const r = value;
    switch (r.type) {
      case "INIT":
      case "REFRESH_FONTS":
      case "CANCEL":
        return true;
      case "FOCUS":
        return typeof r.id === "string" && r.id.length < 256;
      case "RESIZE":
        return Number.isFinite(r.width) && Number.isFinite(r.height);
      case "APPLY":
        return typeof r.planId === "string";
      case "PLAN":
        return typeof r.inventoryId === "string" && Array.isArray(r.mappings) && r.mappings.length < 1e4 && r.mappings.every((m) => m && typeof m.source === "string" && isFont(m.target));
      case "SCAN": {
        const o = r.options;
        return !!o && ["selection", "page", "document"].includes(o.scope) && ["includeHidden", "includeLocked", "includeInstances", "includeComponents"].every((k) => typeof o[k] === "boolean");
      }
      default:
        return false;
    }
  }

  // src/engine.ts
  var pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  var textError = (e) => e instanceof Error ? e.message : String(e);
  var copyFont = (f) => __spreadValues({ family: f.family, style: f.style }, f.variationSettings ? { variationSettings: __spreadValues({}, f.variationSettings) } : {});
  function hasFontBinding(value) {
    const bindings = value;
    return !!bindings && ["fontFamily", "fontStyle", "fontWeight"].some((k) => bindings[k] !== void 0);
  }
  function policyReason(node, options) {
    let current = node;
    while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
      if ("locked" in current && current.locked && !options.includeLocked) return "Locked layer or ancestor";
      if ("visible" in current && !current.visible && !options.includeHidden) return "Hidden layer or ancestor";
      if (current.type === "INSTANCE" && !options.includeInstances) return "Instance text";
      if ((current.type === "COMPONENT" || current.type === "COMPONENT_SET") && !options.includeComponents) return "Main component text";
      current = current.parent;
    }
  }
  function normalizeRoots(nodes) {
    const ids = new Set(nodes.map((n) => n.id));
    const seen = /* @__PURE__ */ new Set();
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
    let segments;
    if (!characters.length) {
      if (node.fontName === figma.mixed) throw new Error("Empty text has no uniform font");
      segments = [{ start: 0, end: 0, font: copyFont(node.fontName), styleId: typeof node.textStyleId === "string" ? node.textStyleId : "", bindings: JSON.stringify(node.boundVariables || {}) }];
    } else {
      segments = node.getStyledTextSegments(["fontName", "textStyleId", "boundVariables"]).map((s) => ({ start: s.start, end: s.end, font: copyFont(s.fontName), styleId: s.textStyleId, bindings: JSON.stringify(s.boundVariables || {}) }));
    }
    if (hasFontBinding(node.boundVariables) || segments.some((s) => hasFontBinding(JSON.parse(s.bindings)))) throw new Error("Font variable binding");
    return { id: node.id, name: node.name, characters, segments, signature: JSON.stringify(segments) };
  }
  function compileActions(snapshot, mappings) {
    const actions = [];
    let priorSegment;
    for (const segment of snapshot.segments) {
      const target = mappings.get(fontKey(segment.font));
      if (!target || fontKey(target) === fontKey(segment.font)) {
        priorSegment = segment;
        continue;
      }
      const previous = actions[actions.length - 1];
      if (previous && previous.end === segment.start && fontKey(previous.target) === fontKey(target) && (priorSegment == null ? void 0 : priorSegment.styleId) === segment.styleId && priorSegment.bindings === segment.bindings) previous.end = segment.end;
      else actions.push({ start: segment.start, end: segment.end, target: copyFont(target) });
      priorSegment = segment;
    }
    return actions;
  }
  var FontEngine = class {
    constructor(send2) {
      this.send = send2;
      this.snapshots = /* @__PURE__ */ new Map();
      this.serial = 0;
      this.cancelled = false;
      this.loads = /* @__PURE__ */ new Map();
      this.catalog = /* @__PURE__ */ new Set();
      this.busy = false;
      this.scopePages = /* @__PURE__ */ new Set();
      this.scopeRoots = /* @__PURE__ */ new Set();
    }
    get isBusy() {
      return this.busy;
    }
    cancel() {
      this.cancelled = true;
    }
    setCatalog(fonts2) {
      this.catalog = new Set(fonts2.map(loadKey));
    }
    invalidate(reason) {
      this.plan = void 0;
      this.inventory = void 0;
      this.snapshots.clear();
      this.send({ type: "INVALIDATED", reason });
    }
    progress(stage, done, total) {
      this.send({ type: "PROGRESS", stage, done, total });
    }
    async scan(options) {
      if (this.busy) throw new Error("Wait for the current operation to finish.");
      this.busy = true;
      this.cancelled = false;
      this.plan = void 0;
      this.inventory = void 0;
      this.snapshots.clear();
      this.send({ type: "BUSY", operation: "scan" });
      const start = Date.now();
      const skipped = {};
      const usage = /* @__PURE__ */ new Map();
      let scanned = 0;
      figma.skipInvisibleInstanceChildren = false;
      try {
        const page = figma.currentPage;
        const selectedRoots = normalizeRoots(page.selection);
        this.scopeRoots = new Set(selectedRoots.map((n) => n.id));
        if (options.scope === "selection" && !selectedRoots.length) throw new Error("Select a text layer, frame, or group in Figma, then scan again.");
        const pages = options.scope === "document" ? [...figma.root.children] : [page];
        this.scopePages = new Set(pages.map((p) => p.id));
        for (let index = 0; index < pages.length; index++) {
          if (this.cancelled) break;
          const targetPage = pages[index];
          this.progress(`Loading ${targetPage.name}`, index, pages.length);
          await targetPage.loadAsync();
          const stack = options.scope === "selection" ? [...selectedRoots] : [...targetPage.children];
          let sliceStart = Date.now();
          while (stack.length) {
            if (this.cancelled) break;
            const node = stack.pop();
            if ("children" in node) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
            if (node.type === "TEXT") {
              scanned++;
              try {
                const reason = policyReason(node, options);
                if (reason) throw new Error(reason);
                const snapshot = takeSnapshot(node);
                this.snapshots.set(node.id, snapshot);
                const missing = node.hasMissingFont;
                for (const segment of snapshot.segments) {
                  const key = fontKey(segment.font);
                  let row = usage.get(key);
                  if (!row) {
                    row = { key, font: segment.font, layers: 0, ranges: 0, missing: false, styled: false, ids: /* @__PURE__ */ new Set() };
                    usage.set(key, row);
                  }
                  row.ids.add(node.id);
                  row.ranges++;
                  row.layers = row.ids.size;
                  row.missing || (row.missing = missing && !this.catalog.has(loadKey(segment.font)));
                  row.styled || (row.styled = !!segment.styleId);
                }
              } catch (e) {
                const reason = textError(e);
                skipped[reason] = (skipped[reason] || 0) + 1;
              }
            }
            if (Date.now() - sliceStart >= 10) {
              this.progress(`Scanning ${targetPage.name}`, scanned, 0);
              await pause();
              sliceStart = Date.now();
            }
          }
        }
        if (this.cancelled) {
          this.snapshots.clear();
          this.send({ type: "CANCELLED" });
          return;
        }
        const fonts2 = [...usage.values()].map((_a) => {
          var _b = _a, { ids: _ids } = _b, row = __objRest(_b, ["ids"]);
          return row;
        }).sort((a, b) => a.font.family.localeCompare(b.font.family) || a.font.style.localeCompare(b.font.style));
        this.inventory = { id: `inventory-${++this.serial}`, options: __spreadValues({}, options), pageName: options.scope === "document" ? "Entire file" : page.name, fonts: fonts2, layers: this.snapshots.size, ranges: fonts2.reduce((sum, row) => sum + row.ranges, 0), scanned, skipped, duration: Date.now() - start };
        this.send({ type: "INVENTORY", inventory: this.inventory });
      } finally {
        this.busy = false;
      }
    }
    createPlan(inventoryId, input) {
      if (this.busy) throw new Error("Wait for the current operation to finish.");
      if (!this.inventory || this.inventory.id !== inventoryId) throw new Error("This inventory has expired. Scan again.");
      this.plan = void 0;
      const sources = new Set(this.inventory.fonts.map((f) => f.key));
      const mappings = /* @__PURE__ */ new Map();
      for (const mapping of input) {
        if (!sources.has(mapping.source)) throw new Error("A mapping refers to a source outside this inventory.");
        if (!this.catalog.has(loadKey(mapping.target))) throw new Error(`The destination ${mapping.target.family} ${mapping.target.style} is unavailable. Refresh fonts.`);
        if (mappings.has(mapping.source)) throw new Error("Conflicting duplicate source mapping.");
        mappings.set(mapping.source, mapping.target);
      }
      const nodes = [];
      const targets = /* @__PURE__ */ new Set();
      let ranges = 0, styledLayers = 0, variableRanges = 0;
      for (const snapshot of this.snapshots.values()) {
        const actions = compileActions(snapshot, mappings);
        if (!actions.length) continue;
        nodes.push({ snapshot, actions });
        ranges += actions.length;
        if (snapshot.segments.some((s) => s.styleId)) styledLayers++;
        for (const action of actions) targets.add(loadKey(action.target));
        variableRanges += snapshot.segments.filter((s) => s.font.variationSettings && mappings.has(fontKey(s.font)) && fontKey(mappings.get(fontKey(s.font))) !== fontKey(s.font)).length;
      }
      if (!nodes.length) throw new Error("Choose a different destination for at least one source font.");
      const review = { id: `plan-${++this.serial}`, inventoryId, layers: nodes.length, ranges, fontsToLoad: targets.size, styledLayers, variableRanges, unmappedLayers: this.snapshots.size - nodes.length };
      this.plan = { review, nodes };
      this.send({ type: "REVIEW", review });
    }
    async load(font) {
      const key = loadKey(font);
      let promise = this.loads.get(key);
      if (!promise) {
        promise = figma.loadFontAsync({ family: font.family, style: font.style }).catch((e) => {
          this.loads.delete(key);
          throw e;
        });
        this.loads.set(key, promise);
      }
      await promise;
    }
    async apply(planId) {
      if (this.busy) throw new Error("Wait for the current operation to finish.");
      if (!this.plan || this.plan.review.id !== planId || !this.inventory) throw new Error("This review has expired. Review your mappings again.");
      const plan = this.plan, options = this.inventory.options;
      this.plan = void 0;
      this.busy = true;
      this.cancelled = false;
      this.send({ type: "BUSY", operation: "apply" });
      const start = Date.now();
      const result = { cancelled: false, changedLayers: 0, changedRanges: 0, skippedLayers: 0, failedLayers: 0, issues: [], duration: 0 };
      let undoOpened = false;
      try {
        const fonts2 = [...new Map(plan.nodes.flatMap((n) => n.actions).map((a) => [loadKey(a.target), a.target])).values()];
        let cursor = 0, loaded = 0;
        let loadError;
        await Promise.all(Array.from({ length: Math.min(4, fonts2.length) }, async () => {
          while (cursor < fonts2.length && !this.cancelled) {
            const font = fonts2[cursor++];
            try {
              await this.load(font);
              loaded++;
              this.progress("Loading destination fonts", loaded, fonts2.length);
            } catch (e) {
              loadError = e;
              this.cancelled = true;
            }
          }
        }));
        if (loadError) throw new Error(`No fonts changed. A destination font could not load: ${textError(loadError)}`);
        let sliceStart = Date.now();
        for (let index = 0; index < plan.nodes.length && !this.cancelled; index++) {
          const { snapshot, actions } = plan.nodes[index];
          let changed = 0;
          try {
            const node = await figma.getNodeByIdAsync(snapshot.id);
            if (this.cancelled) break;
            if (!node || node.type !== "TEXT") throw new SkipError("Layer was removed or is no longer text");
            const policy = policyReason(node, options);
            if (policy) throw new SkipError(policy);
            if (this.inventory) {
              let ancestor = node;
              while (ancestor && ancestor.type !== "PAGE") ancestor = ancestor.parent;
              if (!ancestor || !this.scopePages.has(ancestor.id)) throw new SkipError("Layer moved outside the scanned pages");
            }
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
            if (live.characters !== snapshot.characters || live.signature !== snapshot.signature) throw new SkipError("Text or font formatting changed after scan");
            if (!undoOpened) {
              figma.commitUndo();
              undoOpened = true;
            }
            for (const action of actions) {
              if (snapshot.characters.length === 0) node.fontName = action.target;
              else node.setRangeFontName(action.start, action.end, action.target);
              changed++;
              result.changedRanges++;
              const assigned = snapshot.characters.length === 0 ? node.fontName : node.getRangeFontName(action.start, action.end);
              if (assigned === figma.mixed || assigned.family !== action.target.family || assigned.style !== action.target.style) throw new Error("Figma did not retain the requested destination font");
            }
          } catch (e) {
            if (e instanceof SkipError) result.skippedLayers++;
            else result.failedLayers++;
            result.issues.push({ id: snapshot.id, name: snapshot.name, reason: textError(e) });
          }
          if (changed) result.changedLayers++;
          if (Date.now() - sliceStart >= 10 || index === plan.nodes.length - 1) {
            this.progress("Replacing fonts", index + 1, plan.nodes.length);
            await pause();
            sliceStart = Date.now();
          }
        }
        result.cancelled = this.cancelled;
        result.duration = Date.now() - start;
        this.send({ type: "RESULT", result });
      } finally {
        if (undoOpened) figma.commitUndo();
        this.busy = false;
        this.inventory = void 0;
        this.snapshots.clear();
      }
    }
  };
  var SkipError = class extends Error {
  };

  // src/main.ts
  var send = (message) => figma.ui.postMessage(message);
  var engine = new FontEngine(send);
  var fonts;
  var fontRequest;
  var context = () => send({ type: "CONTEXT", selected: figma.currentPage.selection.length, pageName: figma.currentPage.name });
  async function loadCatalog(refresh = false) {
    if (fontRequest) return fontRequest;
    if (fonts && !refresh) {
      send({ type: "FONTS", fonts });
      return;
    }
    fontRequest = (async () => {
      let timer;
      const available = await Promise.race([
        figma.listAvailableFontsAsync(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Figma did not return its font list within 20 seconds. Check that the editor is ready, then retry the connection.")), 2e4);
        })
      ]).finally(() => {
        if (timer !== void 0) clearTimeout(timer);
      });
      fonts = available.map((f) => ({ family: f.fontName.family, style: f.fontName.style })).sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style));
      engine.setCatalog(fonts);
      send({ type: "FONTS", fonts });
      console.info("[Font Replacer Pro 0.1.2] Font catalog ready:", fonts.length);
    })();
    try {
      await fontRequest;
    } finally {
      fontRequest = void 0;
    }
  }
  figma.on("selectionchange", context);
  figma.on("currentpagechange", context);
  figma.on("stylechange", () => {
    if (!engine.isBusy) engine.invalidate("Text styles changed. Scan again before replacing fonts.");
  });
  figma.ui.onmessage = async (value) => {
    if (!isRequest(value)) {
      send({ type: "ERROR", message: "Invalid plugin request." });
      return;
    }
    try {
      switch (value.type) {
        case "INIT":
          console.info("[Font Replacer Pro 0.1.2] UI handshake received");
          context();
          await loadCatalog();
          break;
        case "REFRESH_FONTS":
          if (engine.isBusy) throw new Error("Wait for the current operation to finish.");
          await loadCatalog(true);
          break;
        case "SCAN":
          if (engine.isBusy) throw new Error("Wait for the current operation to finish.");
          await loadCatalog();
          await engine.scan(value.options);
          break;
        case "PLAN":
          engine.createPlan(value.inventoryId, value.mappings);
          break;
        case "APPLY":
          await engine.apply(value.planId);
          break;
        case "CANCEL":
          engine.cancel();
          break;
        case "FOCUS": {
          if (engine.isBusy) throw new Error("Finish or cancel the operation before navigating.");
          const node = await figma.getNodeByIdAsync(value.id);
          if (!node || !("visible" in node)) throw new Error("This layer is no longer available.");
          let p = node;
          while (p && p.type !== "PAGE") p = p.parent;
          if ((p == null ? void 0 : p.type) === "PAGE") await figma.setCurrentPageAsync(p);
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
          break;
        }
        case "RESIZE":
          figma.ui.resize(Math.max(400, Math.min(900, Math.round(value.width))), Math.max(500, Math.min(1e3, Math.round(value.height))));
          break;
      }
    } catch (e) {
      send({ type: "ERROR", message: e instanceof Error ? e.message : String(e) });
    }
  };
  console.info("[Font Replacer Pro 0.1.2] Sandbox ready");
  figma.showUI(__html__, { width: 460, height: 680, themeColors: true });
  context();
  void loadCatalog().catch((e) => send({ type: "ERROR", message: e instanceof Error ? e.message : String(e) }));
})();
