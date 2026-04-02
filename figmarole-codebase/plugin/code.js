// figmarole — Figma Plugin (sandbox thread)
// Receives captured DOM tree JSON from ui.html and builds native Figma nodes.

figma.showUI(__html__, { width: 600, height: 480, title: 'figmarole' });

figma.ui.postMessage({
  type:     'file_info',
  fileKey:  figma.fileKey  || 'local',
  fileName: figma.root.name || 'Untitled',
});

// ─── Message bridge ───────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'resize':  figma.ui.resize(msg.w || 600, Math.round(msg.h)); return;
    case 'notify':  figma.notify(msg.text, { timeout: msg.timeout || 3000, error: !!msg.error }); return;
    case 'open_url': figma.openExternal(msg.url); return;
    case 'build':   await handleBuild(msg.data); return;
  }
};

// ─── Build handler ────────────────────────────────────────────────────────────

async function handleBuild(data) {
  if (!data || !data.captures || data.captures.length === 0) {
    figma.notify('No capture data received.', { error: true });
    figma.ui.postMessage({ type: 'build_done', ok: false, error: 'No data' });
    return;
  }

  figma.notify('Building design…', { timeout: 120000 });

  try {
    const page    = figma.currentPage;
    const LABEL_H = 32;
    const GAP     = 80;
    let cursorX   = nextCanvasX(page);
    const frames  = [];

    await resolveFont('Inter', '400', 'normal');

    for (const capture of data.captures) {
      const tree = capture.tree;
      if (!tree) continue;

      const fw = Math.max(capture.width  || tree.rect.w || 1440, 1);
      const fh = Math.max(capture.height || tree.rect.h || 900,  1);

      // Label
      const label     = figma.createText();
      label.fontName  = await resolveFont('Inter', '400', 'normal');
      label.characters = `${capture.width}px`;
      label.fontSize  = 13;
      label.fills     = [solidFill({ r: 0.5, g: 0.5, b: 0.5, a: 1 })];
      label.x = cursorX;
      label.y = -LABEL_H;
      page.appendChild(label);

      // Viewport frame
      const frame        = figma.createFrame();
      frame.name         = `${data.title || 'figmarole'} — ${capture.width}px`;
      frame.x            = cursorX;
      frame.y            = 0;
      frame.resize(fw, fh);
      frame.fills        = [solidFill({ r: 1, g: 1, b: 1, a: 1 })];
      frame.layoutMode   = 'NONE';
      frame.clipsContent = true;
      page.appendChild(frame);

      // Build children — root context: not an auto-layout parent
      const rootCtx = { isAutoLayout: false, flexDir: null, alignItems: 'stretch' };
      const absX = tree.rect ? tree.rect.x : 0;
      const absY = tree.rect ? tree.rect.y : 0;

      for (const child of (tree.children || [])) {
        await buildNode(child, frame, absX, absY, rootCtx);
      }

      frames.push(frame);
      cursorX += fw + GAP;
    }

    figma.currentPage.selection = frames;
    figma.viewport.scrollAndZoomIntoView(frames);
    figma.notify(`Done! ${frames.length} viewport${frames.length > 1 ? 's' : ''} built.`, { timeout: 3000 });
    figma.ui.postMessage({ type: 'build_done', ok: true });

  } catch (err) {
    console.error('[figmarole] Build error:', err);
    figma.notify('Error: ' + err.message, { error: true });
    figma.ui.postMessage({ type: 'build_done', ok: false, error: err.message });
  }
}

function nextCanvasX(page) {
  let maxX = 0;
  for (const n of page.children) {
    if ('x' in n && 'width' in n) maxX = Math.max(maxX, n.x + n.width + 100);
  }
  return maxX;
}

// ─── Recursive node builder ───────────────────────────────────────────────────
//
// parentContext = { isAutoLayout: bool, flexDir: 'row'|'column'|null, alignItems: string }
//
// KEY RULE:
//   When parent is auto-layout AND child is normal-flow (not absolute/fixed),
//   we do NOT set x/y — Figma's auto-layout engine positions the child.
//   When parent is auto-layout AND child is position:absolute/fixed,
//   we set layoutPositioning='ABSOLUTE' and provide x/y.
//   When parent is NOT auto-layout, we always set x/y (absolute coords).

async function buildNode(data, parentNode, parentAbsX, parentAbsY, parentCtx) {
  if (!data || !data.rect) return;

  const x = data.rect.x - parentAbsX;
  const y = data.rect.y - parentAbsY;
  const w = Math.max(data.rect.w, 1);
  const h = Math.max(data.rect.h, 1);
  const s = data.styles || {};

  if (s.display === 'none' || s.visibility === 'hidden') return;

  try {
    if (data.isText && data.text) {
      await buildTextNode(data, parentNode, x, y, w, h, s, parentCtx);
    } else if (data.isTextInBox && data.text) {
      await buildTextInBoxNode(data, parentNode, x, y, w, h, s, parentCtx);
    } else if (data.tag === 'img' && data.src) {
      await buildImageNode(data, parentNode, x, y, w, h, s, parentCtx);
    } else if (data.tag === 'svg' && data.svgContent) {
      await buildSvgNode(data, parentNode, x, y, w, h, s, parentCtx);
    } else {
      await buildFrameNode(data, parentNode, x, y, w, h, s, parentCtx);
    }
  } catch (err) {
    console.warn(`[figmarole] Skipped <${data.tag}> "${data.name}":`, err.message);
  }
}

// ─── Positioning helper ───────────────────────────────────────────────────────

function positionNode(node, x, y, w, h, s, parentCtx) {
  node.resize(Math.max(w, 1), Math.max(h, 1));

  const isAbsolute = s.position === 'absolute' || s.position === 'fixed';

  if (parentCtx && parentCtx.isAutoLayout && !isAbsolute) {
    // Let auto-layout handle position — apply Figma sizing modes instead
    applyChildSizingModes(node, s, parentCtx);
  } else {
    node.x = x;
    node.y = y;
    if (isAbsolute && parentCtx && parentCtx.isAutoLayout) {
      try { node.layoutPositioning = 'ABSOLUTE'; } catch (_) {}
    }
  }
}

function applyChildSizingModes(node, s, parentCtx) {
  const flexGrow = parseFloat(s.flexGrow) || 0;
  const isRow    = !parentCtx.flexDir || parentCtx.flexDir.includes('row');

  // Primary axis
  if (flexGrow > 0) {
    node.layoutGrow = 1;
    try {
      if (isRow) node.layoutSizingHorizontal = 'FILL';
      else       node.layoutSizingVertical   = 'FILL';
    } catch (_) {}
  } else {
    node.layoutGrow = 0;
    const wStr = s.width  || '';
    const hStr = s.height || '';
    try {
      if (isRow  && wStr.endsWith('%')) node.layoutSizingHorizontal = 'FILL';
      if (!isRow && hStr.endsWith('%')) node.layoutSizingVertical   = 'FILL';
    } catch (_) {}
  }

  // Counter axis — stretch behaviour
  const ai = (s.alignSelf === 'auto' || !s.alignSelf) ? (parentCtx.alignItems || 'stretch') : s.alignSelf;
  if (ai === 'stretch') {
    try {
      if (isRow) node.layoutSizingVertical   = 'FILL';
      else       node.layoutSizingHorizontal = 'FILL';
    } catch (_) {}
  }
}

// ─── TEXT node ────────────────────────────────────────────────────────────────

async function buildTextNode(data, parentNode, x, y, w, h, s, parentCtx) {
  const node     = figma.createText();
  node.name      = data.name || 'text';
  const fontName = await resolveFont(s.fontFamily, s.fontWeight, s.fontStyle);
  node.fontName  = fontName;
  node.characters = data.text || '';

  applyTextStyles(node, s);

  // Sizing
  const isInAutoLayout = parentCtx && parentCtx.isAutoLayout;
  if (isInAutoLayout) {
    node.textAutoResize = 'WIDTH_AND_HEIGHT';
    applyChildSizingModes(node, s, parentCtx);
  } else {
    node.x = x;
    node.y = y;
    node.textAutoResize = 'HEIGHT';
    try { node.resize(Math.max(w, 1), Math.max(h, 1)); } catch (_) {}
  }

  applyOpacity(node, s.opacity);
  applyBlendMode(node, s.mixBlendMode);
  parentNode.appendChild(node);
  return node;
}

// ─── TEXT-IN-BOX node (e.g. button, badge, pill) ─────────────────────────────
// Creates a frame for the visual container, then a text node inside.

async function buildTextInBoxNode(data, parentNode, x, y, w, h, s, parentCtx) {
  const frame  = figma.createFrame();
  frame.name   = data.name || data.tag || 'text-box';

  // Visual styling on the container frame
  applyFills(frame, s);
  applyBorderRadius(frame, s);
  applyBorders(frame, s);
  applyShadows(frame, s);
  applyOpacity(frame, s.opacity);
  applyBlendMode(frame, s.mixBlendMode);
  applyBlur(frame, s.filter);
  frame.clipsContent = s.overflow === 'hidden' || s.overflow === 'clip';

  // Use auto-layout so padding is applied correctly and the text node fills
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisAlignItems   = 'CENTER';
  frame.counterAxisAlignItems   = 'CENTER';
  frame.paddingTop    = px(s.paddingTop);
  frame.paddingBottom = px(s.paddingBottom);
  frame.paddingLeft   = px(s.paddingLeft);
  frame.paddingRight  = px(s.paddingRight);
  try {
    frame.primaryAxisSizingMode   = 'AUTO';
    frame.counterAxisSizingMode   = 'FIXED';
  } catch (_) {}

  positionNode(frame, x, y, w, h, s, parentCtx);
  parentNode.appendChild(frame);

  // Inner text node
  const textNode = figma.createText();
  textNode.name  = 'label';
  const fontName = await resolveFont(s.fontFamily, s.fontWeight, s.fontStyle);
  textNode.fontName  = fontName;
  textNode.characters = data.text || '';
  applyTextStyles(textNode, s);
  try {
    textNode.layoutSizingHorizontal = 'FILL';
    textNode.layoutSizingVertical   = 'HUG';
  } catch (_) {}
  frame.appendChild(textNode);

  return frame;
}

// ─── IMAGE node ───────────────────────────────────────────────────────────────

async function buildImageNode(data, parentNode, x, y, w, h, s, parentCtx) {
  const node = figma.createRectangle();
  node.name  = data.alt || data.name || 'image';

  try {
    const img       = await figma.createImageAsync(data.src);
    const scaleMode = s.objectFit === 'contain' ? 'FIT'
                    : s.objectFit === 'cover'   ? 'FILL'
                    : 'FILL';
    node.fills = [{ type: 'IMAGE', scaleMode, imageHash: img.hash }];
  } catch (_) {
    node.fills = [solidFill({ r: 0.88, g: 0.88, b: 0.88, a: 1 })];
  }

  applyBorderRadius(node, s);
  applyOpacity(node, s.opacity);
  applyBlendMode(node, s.mixBlendMode);
  positionNode(node, x, y, w, h, s, parentCtx);
  parentNode.appendChild(node);
  return node;
}

// ─── SVG node ─────────────────────────────────────────────────────────────────

async function buildSvgNode(data, parentNode, x, y, w, h, s, parentCtx) {
  try {
    const node = figma.createNodeFromSvg(data.svgContent);
    node.name  = data.name || 'svg';
    applyOpacity(node, s.opacity);
    applyBlendMode(node, s.mixBlendMode);
    positionNode(node, x, y, w, h, s, parentCtx);
    parentNode.appendChild(node);
    return node;
  } catch (err) {
    console.warn('[figmarole] SVG parse error:', err.message);
  }
}

// ─── FRAME node ───────────────────────────────────────────────────────────────

async function buildFrameNode(data, parentNode, x, y, w, h, s, parentCtx) {
  const node  = figma.createFrame();
  node.name   = data.name || data.tag || 'frame';

  // ── Visual styling ──────────────────────────────────────────────────────────
  applyFills(node, s);
  applyBorderRadius(node, s);
  applyBorders(node, s);
  applyShadows(node, s);
  applyOpacity(node, s.opacity);
  applyBlendMode(node, s.mixBlendMode);
  applyBlur(node, s.filter);
  node.clipsContent = s.overflow === 'hidden' || s.overflow === 'clip';

  // ── Auto-layout / positioning ───────────────────────────────────────────────
  const isFlex = s.display === 'flex' || s.display === 'inline-flex';
  const isGrid = s.display === 'grid' || s.display === 'inline-grid';

  let thisCtx = { isAutoLayout: false, flexDir: null, alignItems: 'stretch' };

  if (isFlex) {
    const isColumn = s.flexDirection && s.flexDirection.includes('column');
    node.layoutMode = isColumn ? 'VERTICAL' : 'HORIZONTAL';
    thisCtx = { isAutoLayout: true, flexDir: isColumn ? 'column' : 'row', alignItems: s.alignItems || 'stretch' };

    if (!isColumn && (s.flexWrap === 'wrap' || s.flexWrap === 'wrap-reverse')) {
      try { node.layoutWrap = 'WRAP'; } catch (_) {}
    }

    // Primary axis alignment
    const jc = s.justifyContent || '';
    if      (jc === 'center')                         node.primaryAxisAlignItems = 'CENTER';
    else if (jc === 'flex-end'   || jc === 'end')     node.primaryAxisAlignItems = 'MAX';
    else if (jc === 'space-between')                  node.primaryAxisAlignItems = 'SPACE_BETWEEN';
    else                                              node.primaryAxisAlignItems = 'MIN';

    // Counter axis alignment
    const ai = s.alignItems || '';
    if      (ai === 'center')                         node.counterAxisAlignItems = 'CENTER';
    else if (ai === 'flex-end'   || ai === 'end')     node.counterAxisAlignItems = 'MAX';
    else if (ai === 'flex-start' || ai === 'start')   node.counterAxisAlignItems = 'MIN';
    else                                              node.counterAxisAlignItems = 'MIN';

    // Gap — prefer rowGap/columnGap over shorthand gap
    const isRow  = !isColumn;
    const primaryGap = px(isRow  ? (s.columnGap || s.gap) : (s.rowGap    || s.gap));
    const counterGap = px(isRow  ? (s.rowGap    || s.gap) : (s.columnGap || s.gap));
    node.itemSpacing = primaryGap;
    try { node.counterAxisSpacing = counterGap; } catch (_) {}

    // Padding
    node.paddingTop    = px(s.paddingTop);
    node.paddingBottom = px(s.paddingBottom);
    node.paddingLeft   = px(s.paddingLeft);
    node.paddingRight  = px(s.paddingRight);

    // Container sizing
    const wStr = s.width  || '';
    const hStr = s.height || '';
    try {
      node.primaryAxisSizingMode =
        (isRow ? wStr : hStr).includes('auto') ? 'AUTO' : 'FIXED';
      node.counterAxisSizingMode =
        (isRow ? hStr : wStr).includes('auto') ? 'AUTO' : 'FIXED';
    } catch (_) {}

  } else if (isGrid) {
    // Approximate CSS grid as wrapped auto-layout
    node.layoutMode = 'HORIZONTAL';
    try { node.layoutWrap = 'WRAP'; } catch (_) {}
    const colGap = px(s.columnGap || s.gap);
    const rowGap = px(s.rowGap    || s.gap);
    node.itemSpacing = colGap;
    try { node.counterAxisSpacing = rowGap; } catch (_) {}
    node.paddingTop    = px(s.paddingTop);
    node.paddingBottom = px(s.paddingBottom);
    node.paddingLeft   = px(s.paddingLeft);
    node.paddingRight  = px(s.paddingRight);
    thisCtx = { isAutoLayout: true, flexDir: 'row', alignItems: s.alignItems || 'start' };
  } else {
    node.layoutMode = 'NONE';
  }

  // ── Position this node in its parent ────────────────────────────────────────
  positionNode(node, x, y, w, h, s, parentCtx);
  parentNode.appendChild(node);

  // ── Recurse into children ────────────────────────────────────────────────────
  if (data.children && data.children.length > 0) {
    for (const child of data.children) {
      await buildNode(child, node, data.rect.x, data.rect.y, thisCtx);
    }
  }

  return node;
}

// ─── Style helpers ────────────────────────────────────────────────────────────

function applyTextStyles(node, s) {
  const fSize = px(s.fontSize);
  if (fSize >= 1) node.fontSize = fSize;

  applyLineHeight(node, s.lineHeight);

  if (s.letterSpacing && s.letterSpacing !== 'normal') {
    const ls = px(s.letterSpacing);
    if (!isNaN(ls)) node.letterSpacing = { unit: 'PIXELS', value: ls };
  }

  const align = (s.textAlign || '').toLowerCase();
  if      (align === 'center')  node.textAlignHorizontal = 'CENTER';
  else if (align === 'right')   node.textAlignHorizontal = 'RIGHT';
  else if (align === 'justify') node.textAlignHorizontal = 'JUSTIFIED';

  const deco = (s.textDecoration || '').toLowerCase();
  if      (deco.includes('underline'))    node.textDecoration = 'UNDERLINE';
  else if (deco.includes('line-through')) node.textDecoration = 'STRIKETHROUGH';

  const tt = (s.textTransform || '').toLowerCase();
  if      (tt === 'uppercase') node.textCase = 'UPPER';
  else if (tt === 'lowercase') node.textCase = 'LOWER';
  else if (tt === 'capitalize') node.textCase = 'TITLE';

  const color = parseCssColor(s.color);
  if (color) node.fills = [solidFill(color)];
}

// ── Fills: solid colour, linear gradient, radial gradient, background URL image

function applyFills(node, s) {
  const fills = [];

  // Background image (gradient or url) — CSS may layer multiple, process all
  if (s.bgImage && s.bgImage !== 'none') {
    // Split multiple backgrounds at top-level commas (outside parentheses)
    const layers = splitTopLevel(s.bgImage, ',');
    for (const layer of layers) {
      const t = layer.trim();
      if (t.startsWith('linear-gradient')) {
        const gf = parseLinearGradient(t);
        if (gf) fills.push(gf);
      } else if (t.startsWith('radial-gradient')) {
        // Approximate as solid with the first stop colour
        const firstColor = extractFirstGradientColor(t);
        if (firstColor) fills.push(solidFill(firstColor));
      } else if (t.startsWith('url(')) {
        // Background image URL — will be loaded as image fill
        const url = t.match(/url\(["']?([^"')]+)["']?\)/);
        if (url && url[1]) {
          // Push a placeholder; we'll resolve async below
          fills.push({ __bgUrl: url[1] });
        }
      }
    }
  }

  // Solid background colour (rendered behind gradient layers in CSS, so push last)
  const bgColor = parseCssColor(s.bg);
  if (bgColor && bgColor.a > 0.01) {
    fills.push(solidFill(bgColor));
  }

  // Resolve any url() image fills synchronously we can (others as grey placeholder)
  const resolvedFills = fills.map(f => {
    if (f.__bgUrl) return solidFill({ r: 0.88, g: 0.88, b: 0.88, a: 1 }); // placeholder
    return f;
  });

  node.fills = resolvedFills.length > 0 ? resolvedFills : [];

  // Async: replace grey placeholders with actual images
  for (let i = 0; i < fills.length; i++) {
    if (fills[i].__bgUrl) {
      const url = fills[i].__bgUrl;
      const idx = i;
      figma.createImageAsync(url).then(img => {
        try {
          const scaleMode = s.bgSize === 'contain' ? 'FIT'
                          : s.bgSize === 'cover'   ? 'FILL'
                          : 'FILL';
          const newFills = node.fills.slice();
          newFills[idx]  = { type: 'IMAGE', scaleMode, imageHash: img.hash };
          node.fills     = newFills;
        } catch (_) {}
      }).catch(() => {});
    }
  }
}

function applyBorderRadius(node, s) {
  const tl = px(s.brTL), tr = px(s.brTR);
  const bl = px(s.brBL), br = px(s.brBR);
  try {
    if (tl === tr && tr === bl && bl === br) {
      node.cornerRadius = tl;
    } else {
      node.topLeftRadius     = tl;
      node.topRightRadius    = tr;
      node.bottomLeftRadius  = bl;
      node.bottomRightRadius = br;
    }
  } catch (_) {}
}

function applyBorders(node, s) {
  // Collect visible sides
  const sides = [
    { style: s.bTopStyle,    width: px(s.bTopWidth),    color: s.bTopColor,    prop: 'strokeTopWeight'    },
    { style: s.bRightStyle,  width: px(s.bRightWidth),  color: s.bRightColor,  prop: 'strokeRightWeight'  },
    { style: s.bBottomStyle, width: px(s.bBottomWidth), color: s.bBottomColor, prop: 'strokeBottomWeight' },
    { style: s.bLeftStyle,   width: px(s.bLeftWidth),   color: s.bLeftColor,   prop: 'strokeLeftWeight'   },
  ].filter(sd => sd.style && sd.style !== 'none' && sd.width > 0);

  if (sides.length === 0) {
    // Check outline as fallback border
    if (s.outlineStyle && s.outlineStyle !== 'none') {
      const ow = px(s.outlineWidth);
      if (ow > 0) {
        const oc = parseCssColor(s.outlineColor);
        if (oc) {
          node.strokes      = [solidFill(oc)];
          node.strokeWeight = ow;
          node.strokeAlign  = 'OUTSIDE';
        }
      }
    }
    return;
  }

  // Use the most common colour for the stroke fill
  const primaryColor = parseCssColor(sides[0].color);
  if (primaryColor) node.strokes = [solidFill(primaryColor)];
  node.strokeAlign = 'INSIDE';

  const allSameWidth = sides.every(sd => sd.width === sides[0].width);
  if (allSameWidth) {
    node.strokeWeight = sides[0].width;
  } else {
    // Per-side widths
    try {
      node.strokeTopWeight    = px(s.bTopWidth);
      node.strokeRightWeight  = px(s.bRightWidth);
      node.strokeBottomWeight = px(s.bBottomWidth);
      node.strokeLeftWeight   = px(s.bLeftWidth);
    } catch (_) {
      node.strokeWeight = sides[0].width;
    }
  }
}

function applyShadows(node, s) {
  if (!s.boxShadow || s.boxShadow === 'none') return;
  const shadows = [];
  for (const part of splitTopLevel(s.boxShadow, ',')) {
    const sh = parseOneBoxShadow(part.trim());
    if (sh) shadows.push(sh);
  }
  if (shadows.length > 0) node.effects = shadows;
}

function applyOpacity(node, opacityStr) {
  const v = parseFloat(opacityStr);
  if (!isNaN(v) && v < 1) node.opacity = Math.max(0, v);
}

function applyBlendMode(node, bm) {
  if (!bm || bm === 'normal') return;
  const map = {
    multiply:    'MULTIPLY',
    screen:      'SCREEN',
    overlay:     'OVERLAY',
    darken:      'DARKEN',
    lighten:     'LIGHTEN',
    'color-dodge': 'COLOR_DODGE',
    'color-burn':  'COLOR_BURN',
    'hard-light':  'HARD_LIGHT',
    'soft-light':  'SOFT_LIGHT',
    difference:  'DIFFERENCE',
    exclusion:   'EXCLUSION',
    hue:         'HUE',
    saturation:  'SATURATION',
    color:       'COLOR',
    luminosity:  'LUMINOSITY',
  };
  const fig = map[bm.toLowerCase()];
  if (fig) try { node.blendMode = fig; } catch (_) {}
}

function applyBlur(node, filter) {
  if (!filter || filter === 'none') return;
  const m = filter.match(/blur\(\s*([\d.]+)px\s*\)/);
  if (!m) return;
  const radius = parseFloat(m[1]);
  if (radius > 0) {
    try {
      const existing = node.effects || [];
      node.effects = existing.concat([{ type: 'LAYER_BLUR', radius, visible: true }]);
    } catch (_) {}
  }
}

function applyLineHeight(node, lh) {
  if (!lh || lh === 'normal') return;
  const val = parseFloat(lh);
  if (isNaN(val) || val <= 0) return;
  node.lineHeight = lh.includes('%')
    ? { unit: 'PERCENT', value: val }
    : { unit: 'PIXELS',  value: val };
}

// ─── CSS colour → { r,g,b,a } (all 0–1) ─────────────────────────────────────

function parseCssColor(str) {
  if (!str) return null;
  str = str.trim();
  if (str === 'transparent' || str === 'none') return null;

  // rgb / rgba
  const rgba = str.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/
  );
  if (rgba) {
    const a = rgba[4] !== undefined ? parseFloat(rgba[4]) : 1;
    if (a < 0.01) return null;
    return { r: +rgba[1] / 255, g: +rgba[2] / 255, b: +rgba[3] / 255, a };
  }

  // hsl / hsla (approximate)
  const hsla = str.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([\d.]+))?\s*\)/);
  if (hsla) {
    const a = hsla[4] !== undefined ? parseFloat(hsla[4]) : 1;
    if (a < 0.01) return null;
    const rgb = hslToRgb(+hsla[1], +hsla[2] / 100, +hsla[3] / 100);
    return { r: rgb.r, g: rgb.g, b: rgb.b, a: a };
  }

  // hex variants
  const hex8 = str.match(/^#([0-9a-f]{8})$/i);
  if (hex8) {
    const n = parseInt(hex8[1], 16);
    const a = (n & 255) / 255;
    if (a < 0.01) return null;
    return { r: (n >>> 24) / 255, g: ((n >>> 16) & 255) / 255, b: ((n >>> 8) & 255) / 255, a };
  }
  const hex6 = str.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255, a: 1 };
  }
  const hex3 = str.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    const h = hex3[1];
    return {
      r: parseInt(h[0]+h[0], 16) / 255,
      g: parseInt(h[1]+h[1], 16) / 255,
      b: parseInt(h[2]+h[2], 16) / 255, a: 1,
    };
  }

  return null;
}

function hslToRgb(h, s, l) {
  const c  = (1 - Math.abs(2 * l - 1)) * s;
  const x  = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m  = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) {        g = c; b = x; }
  else if (h < 240) {        g = x; b = c; }
  else if (h < 300) { r = x;        b = c; }
  else              { r = c;        b = x; }
  return { r: r + m, g: g + m, b: b + m };
}

// ─── Linear gradient → Figma GRADIENT_LINEAR fill ────────────────────────────

function parseLinearGradient(str) {
  const inner = str.replace(/^linear-gradient\(\s*/, '').replace(/\)\s*$/, '');
  const parts  = splitTopLevel(inner, ',');
  if (parts.length < 2) return null;

  let angleDeg = 180; // default: to bottom
  let stopStart = 0;

  const first = parts[0].trim();
  if (/^\d/.test(first) && first.includes('deg')) {
    angleDeg = parseFloat(first);
    stopStart = 1;
  } else if (first.startsWith('to ')) {
    const dir = first.toLowerCase();
    const dirMap = {
      'to top': 0, 'to top right': 45, 'to right': 90,
      'to bottom right': 135, 'to bottom': 180,
      'to bottom left': 225, 'to left': 270, 'to top left': 315,
    };
    angleDeg = dirMap[dir] !== undefined ? dirMap[dir] : 180;
    stopStart = 1;
  }

  const stopStrs = parts.slice(stopStart);
  const stops = [];
  for (let i = 0; i < stopStrs.length; i++) {
    const seg = stopStrs[i].trim();
    // Extract colour (rgba/rgb/hsl/hex)
    const colMatch = seg.match(/rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-f]{3,8}/i) ||
                     seg.match(/^[a-z]+/i);
    if (!colMatch) continue;
    const color = parseCssColor(colMatch[0]);
    if (!color) continue;
    const posMatch = seg.match(/([\d.]+)%/);
    const position = posMatch ? parseFloat(posMatch[1]) / 100 : i / Math.max(stopStrs.length - 1, 1);
    stops.push({ color, position });
  }
  if (stops.length < 2) return null;

  // Build gradientTransform: maps gradient-space (0,0)→(1,0) to node-space
  // angle: 0 = to top, 90 = to right (CSS convention)
  const rad = angleDeg * Math.PI / 180;
  const dx  =  Math.sin(rad);
  const dy  = -Math.cos(rad);
  const p1x = 0.5 - dx * 0.5;
  const p1y = 0.5 - dy * 0.5;

  return {
    type: 'GRADIENT_LINEAR',
    gradientTransform: [
      [dx, -dy, p1x],
      [dy,  dx, p1y],
    ],
    gradientStops: stops.map(st => ({
      position: st.position,
      color:    { r: st.color.r, g: st.color.g, b: st.color.b, a: st.color.a },
    })),
    opacity: 1,
  };
}

function extractFirstGradientColor(gradStr) {
  const m = gradStr.match(/rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-f]{3,8}/i);
  return m ? parseCssColor(m[0]) : null;
}

// ─── Box shadow parser ────────────────────────────────────────────────────────

function parseOneBoxShadow(str) {
  if (!str || str === 'none') return null;
  try {
    const inset = str.includes('inset');
    const colorMatch = str.match(/rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-f]{3,8}/i);
    const color = colorMatch ? parseCssColor(colorMatch[0]) : null;
    if (!color) return null;
    const nums = str.replace(/rgba?\([^)]+\)/g, '').match(/-?[\d.]+px/g) || [];
    const [ox = 0, oy = 0, blur = 0, spread = 0] = nums.map(n => parseFloat(n));
    return {
      type:      inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
      color:     { r: color.r, g: color.g, b: color.b, a: color.a },
      offset:    { x: ox, y: oy },
      radius:    Math.max(blur, 0),
      spread:    spread,
      visible:   true,
      blendMode: 'NORMAL',
    };
  } catch (_) { return null; }
}

// ─── Utility: split a string at commas not inside parentheses ─────────────────

function splitTopLevel(str, sep) {
  const result = [];
  let depth = 0, start = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') depth--;
    else if (str[i] === sep && depth === 0) {
      result.push(str.slice(start, i));
      start = i + 1;
    }
  }
  result.push(str.slice(start));
  return result;
}

// ─── Solid fill helper ────────────────────────────────────────────────────────

function solidFill(color) {
  return {
    type:    'SOLID',
    color:   { r: color.r, g: color.g, b: color.b },
    opacity: color.a !== undefined ? color.a : 1,
  };
}

// ─── px() ────────────────────────────────────────────────────────────────────

function px(s) {
  if (!s) return 0;
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

// ─── Font resolver ────────────────────────────────────────────────────────────

const _fontCache = new Map();

async function tryLoad(family, style) {
  const key = `${family}::${style}`;
  if (_fontCache.has(key)) return _fontCache.get(key) ? { family, style } : null;
  try {
    await figma.loadFontAsync({ family, style });
    _fontCache.set(key, true);
    return { family, style };
  } catch (_) {
    _fontCache.set(key, false);
    return null;
  }
}

async function resolveFont(cssFamily = 'Inter', cssWeight = '400', cssStyle = 'normal') {
  const weight   = parseFloat(cssWeight) || 400;
  const isItalic = (cssStyle || '').toLowerCase().includes('italic');

  let weightCandidates;
  if      (weight >= 900) weightCandidates = ['Black', 'ExtraBold', 'Bold'];
  else if (weight >= 800) weightCandidates = ['ExtraBold', 'Black', 'Bold'];
  else if (weight >= 700) weightCandidates = ['Bold', 'SemiBold'];
  else if (weight >= 600) weightCandidates = ['SemiBold', 'Bold'];
  else if (weight >= 500) weightCandidates = ['Medium', 'Regular'];
  else if (weight >= 300) weightCandidates = ['Regular', 'Light'];
  else                    weightCandidates = ['Light', 'Thin', 'Regular'];

  const styleCandidates = isItalic
    ? weightCandidates.flatMap(w => [w === 'Regular' ? 'Italic' : `${w} Italic`, w])
    : weightCandidates;

  const GENERIC = new Set(['serif','sans-serif','monospace','cursive','fantasy',
                            'system-ui','ui-serif','ui-sans-serif','ui-monospace']);
  const families = (cssFamily || 'Inter')
    .split(',').map(f => f.trim().replace(/['"]/g, ''))
    .filter(f => f.length > 0 && !GENERIC.has(f.toLowerCase()))
    .concat(['Inter', 'Roboto', 'Arial']);

  for (const family of families) {
    for (const style of styleCandidates) {
      const r = await tryLoad(family, style);
      if (r) return r;
    }
    const plain = await tryLoad(family, 'Regular');
    if (plain) return plain;
  }
  return { family: 'Inter', style: 'Regular' };
}
