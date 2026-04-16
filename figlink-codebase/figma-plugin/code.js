// Figma Plugin Main Thread — Figlink
// Communicates with ui.html via postMessage, which relays over WebSocket to the link server.

figma.showUI(__html__, { width: 500, height: 300, title: 'Figlink' });

// Send file identity to UI so it can include it in the WebSocket registration
figma.ui.postMessage({
  type: 'file_info',
  fileKey:  figma.fileKey  || figma.root.name,
  fileName: figma.root.name,
});

figma.ui.onmessage = async (msg) => {
  // UI control messages (not Figma API commands)
  if (msg.type === 'resize') {
    figma.ui.resize(240, msg.height);
    return;
  }
  if (msg.type === 'close_plugin') {
    figma.closePlugin();
    return;
  }
  if (msg.type === 'open_url') {
    figma.openExternal(msg.url);
    return;
  }

  const { id, command, params } = msg;
  try {
    const result = await handleCommand(command, params || {});
    figma.ui.postMessage({ id, result });
  } catch (err) {
    figma.ui.postMessage({ id, error: err.message });
  }
};

// ─── Command Router ──────────────────────────────────────────────────────────

async function handleCommand(command, params) {
  switch (command) {
    case 'ping':
      return { status: 'ok', file: figma.root.name, page: figma.currentPage.name };

    case 'get_selection':
      return figma.currentPage.selection.map(n => serializeNode(n, 3));

    case 'get_nodes':
      return getNodes(params);

    case 'get_nodes_flat':
      return getNodesFlat(params);

    case 'rename_node':
      return renameNode(params.nodeId, params.name);

    case 'get_local_styles':
      return getLocalStyles();

    case 'get_all_available_styles':
      return getAllAvailableStyles();

    case 'get_local_variables':
      return getLocalVariables();

    case 'get_all_available_variables':
      return await getAllAvailableVariables();

    case 'get_page_frames':
      return figma.currentPage.children.map(n => ({ id: n.id, name: n.name, type: n.type }));

    case 'get_pages':
      return figma.root.children.map(p => ({ id: p.id, name: p.name }));

    case 'set_current_page': {
      const page = figma.root.children.find(p => p.id === params.pageId);
      if (!page) throw new Error(`Page ${params.pageId} not found`);
      figma.currentPage = page;
      return { ok: true, pageId: page.id, name: page.name };
    }

    case 'apply_text_style':
      return await applyTextStyle(params.nodeId, params.styleId);

    case 'apply_fill_style':
      return applyFillStyle(params.nodeId, params.styleId, params.fillIndex !== undefined ? params.fillIndex : 0);

    case 'apply_fill_variable':
      return applyFillVariable(params.nodeId, params.variableId, params.fillIndex !== undefined ? params.fillIndex : 0);

    case 'set_variable_binding':
      return setVariableBinding(params.nodeId, params.field, params.variableId);

    case 'remove_variable_binding':
      return removeVariableBinding(params.nodeId, params.field);

    case 'set_property':
      return setProperty(params.nodeId, params.field, params.value);

    case 'set_characters':
      return await setCharacters(params.nodeId, params.text);

    case 'resolve_variables':
      return resolveVariables(params.ids);

    case 'get_all_document_variables':
      return getAllDocumentVariables();

    case 'bulk_set_characters':
      return await bulkSetCharacters(params.items);

    case 'bulk_rename':
      return bulkRename(params.renames);

    case 'bulk_apply_text_style':
      return await bulkApplyTextStyle(params.items);

    case 'bulk_apply_text_style_by_key':
      return await bulkApplyTextStyleByKey(params.items);

    case 'bulk_set_variable_binding':
      return bulkSetVariableBinding(params.items);

    case 'bulk_apply_fill_variable':
      return bulkApplyFillVariable(params.items);

    case 'bulk_apply_fill_variable_by_key':
      return await bulkApplyFillVariableByKey(params.items);

    case 'bulk_set_variable_binding_by_key':
      return await bulkSetVariableBindingByKey(params.items);

    case 'import_variables_by_key': {
      // Pre-import an array of variable keys, return { key → localId } map.
      const BATCH = 20;
      const keyToId = {};
      const keys = params.keys || [];
      for (let i = 0; i < keys.length; i += BATCH) {
        await Promise.all(keys.slice(i, i + BATCH).map(async (k) => {
          try {
            const v = await figma.variables.importVariableByKeyAsync(k);
            keyToId[k] = v.id;
          } catch (e) { keyToId[k] = null; }
        }));
      }
      return keyToId;
    }

    case 'bulk_set_property':
      return bulkSetProperty(params.items);

    case 'set_style_property':
      return setStyleProperty(params.styleId, params.field, params.value);

    case 'bulk_set_style_property':
      return bulkSetStyleProperty(params.items);

    case 'set_style_variable_binding':
      return await setStyleVariableBinding(params.styleId, params.field, params.variableId);

    case 'bulk_set_style_variable_binding':
      return await bulkSetStyleVariableBinding(params.items);

    case 'delete_style':
      return deleteStyle(params.styleId);

    case 'bulk_delete_style':
      return bulkDeleteStyle(params.styleIds);

    case 'duplicate_text_style':
      return duplicateTextStyle(params.styleId, params.newName, params.overrides || {});

    case 'bulk_duplicate_text_style':
      return bulkDuplicateTextStyle(params.items);

    case 'clone_component_set':
      return cloneComponentSet(params.nodeId, params.newName, params.optionsToKeep, params.height, params.parentFrameId);

    case 'swap_button_instances':
      return swapButtonInstances(params.containerId, params.newComponentSetId);

    case 'create_node':
      return await createNode(params);

    case 'create_node_tree':
      return await createNodeTree(params);

    case 'set_node_raw':
      return await setNodeRaw(params);

    case 'delete_node':
      return deleteNode(params.nodeId);

    case 'group_as_component_set':
      return groupAsComponentSet(params.nodeIds, params.name, params.parentId);

    case 'flatten_node':
      return flattenNode(params.nodeId);

    case 'reset_instance_spacing':
      return resetInstanceSpacing(params.nodeId);

    case 'reset_instance_text_styles':
      return resetInstanceTextStyles(params.nodeId);

    case 'unclip_text_parent_frames':
      return unclipTextParentFrames(params.nodeId);

    case 'find_image_nodes':
      return findImageNodes(params.nodeId);

    case 'export_node':
      return await exportNode(params.nodeId, params.format || 'PNG', params.scale || 2);

    case 'figma_execute': {
      // Execute arbitrary JS in the plugin context. params.code is a full JS expression or IIFE.
      // eslint-disable-next-line no-eval
      const result = eval(params.code);
      return (result && typeof result.then === 'function') ? await result : result;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// ─── Flatten Node ────────────────────────────────────────────────────────────

function flattenNode(nodeId) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (!node.parent) throw new Error(`Node ${nodeId} has no parent`);

  const parent = node.parent;
  const index = parent.children.indexOf(node);
  const children = [...node.children]; // clone array before moving

  for (const child of children) {
    // Move child to the parent of the node, at the index of the node
    parent.insertChild(index, child);

    // In free-position parents, children need absolute coords in the parent's space
    if (parent.layoutMode === 'NONE') {
      child.x += node.x;
      child.y += node.y;
    }
  }

  // Remove the original node now that its children are moved
  node.remove();

  return { ok: true, flattenedNodeId: nodeId, newChildrenIds: children.map(c => c.id) };
}

// ─── Reset Instance Spacing ──────────────────────────────────────────────────

function resetInstanceSpacing(nodeId) {
  const root = nodeId ? figma.getNodeById(nodeId) : figma.currentPage;
  if (!root) throw new Error(`Node ${nodeId} not found`);

  const SPACING_FIELDS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing'];
  const instances = root.findAll(n => n.type === 'INSTANCE' && n.layoutMode && n.layoutMode !== 'NONE');

  let instancesModified = 0;
  let fieldsReset = 0;

  for (const inst of instances) {
    const master = inst.mainComponent;
    if (!master) continue;

    let changed = false;
    for (const field of SPACING_FIELDS) {
      if (field in inst && field in master && inst[field] !== master[field]) {
        inst[field] = master[field];
        changed = true;
        fieldsReset++;
      }
    }
    if (changed) instancesModified++;
  }

  return { ok: true, instancesModified, fieldsReset, rootId: root.id, rootName: root.name };
}

// ─── Reset Instance Text Styles ──────────────────────────────────────────────

// Walk from a node up to a root, recording the child index at each level.
// Then replay that path in the master to find the corresponding node.
function findCorrespondingMasterNode(node, instanceRoot, masterRoot) {
  const path = [];
  let cur = node;
  while (cur && cur.id !== instanceRoot.id) {
    const parent = cur.parent;
    if (!parent) return null;
    const idx = parent.children ? parent.children.indexOf(cur) : -1;
    if (idx === -1) return null;
    path.unshift(idx);
    cur = parent;
  }
  let masterNode = masterRoot;
  for (const idx of path) {
    if (!masterNode.children || idx >= masterNode.children.length) return null;
    masterNode = masterNode.children[idx];
  }
  return masterNode;
}

function resetInstanceTextStyles(nodeId) {
  const root = nodeId ? figma.getNodeById(nodeId) : figma.currentPage;
  if (!root) throw new Error(`Node ${nodeId} not found`);

  const instances = root.findAll(n => n.type === 'INSTANCE');

  let textsModified = 0;

  for (const inst of instances) {
    const master = inst.mainComponent;
    if (!master) continue;

    const textNodes = inst.findAll(n => n.type === 'TEXT');
    for (const textNode of textNodes) {
      const masterText = findCorrespondingMasterNode(textNode, inst, master);
      if (!masterText || masterText.type !== 'TEXT') continue;

      const masterStyleId = masterText.textStyleId;
      // Only sync when master has a definite style (non-empty, non-mixed)
      if (!masterStyleId || masterStyleId === figma.mixed) continue;
      if (textNode.textStyleId !== masterStyleId) {
        textNode.textStyleId = masterStyleId;
        textsModified++;
      }
    }
  }

  return { ok: true, textsModified, rootId: root.id, rootName: root.name };
}

// ─── Unclip Frames with Direct Text Children ─────────────────────────────────

function unclipTextParentFrames(nodeId) {
  const root = nodeId ? figma.getNodeById(nodeId) : figma.currentPage;
  if (!root) throw new Error(`Node ${nodeId} not found`);

  const CONTAINER_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET']);
  let framesModified = 0;

  const containers = root.findAll(n => CONTAINER_TYPES.has(n.type) && n.clipsContent === true);
  for (const frame of containers) {
    if (!frame.children) continue;
    const hasDirectText = frame.children.some(c => c.type === 'TEXT');
    if (hasDirectText) {
      frame.clipsContent = false;
      framesModified++;
    }
  }

  return { ok: true, framesModified, rootId: root.id, rootName: root.name };
}

// ─── Find Image Nodes ─────────────────────────────────────────────────────────

function findImageNodes(nodeId) {
  const root = nodeId ? figma.getNodeById(nodeId) : figma.currentPage;
  if (!root) throw new Error(`Node ${nodeId} not found`);

  const results = [];
  const seenHashes = new Set();

  function walk(node) {
    const fills = node.fills;
    if (fills && fills !== figma.mixed) {
      for (const fill of fills) {
        if (fill.type === 'IMAGE' && fill.imageHash) {
          if (!seenHashes.has(fill.imageHash)) {
            seenHashes.add(fill.imageHash);
            results.push({ id: node.id, name: node.name, type: node.type, imageHash: fill.imageHash });
          }
          break; // only first image fill per node
        }
      }
    }
    if ('children' in node) {
      for (const child of node.children) walk(child);
    }
  }

  walk(root);
  return results;
}

// ─── Export Node ──────────────────────────────────────────────────────────────

async function exportNode(nodeId, format, scale) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const settings = { format };
  if (format === 'PNG' || format === 'JPG') {
    settings.constraint = { type: 'SCALE', value: scale };
  }

  const bytes = await node.exportAsync(settings);

  // Convert Uint8Array to base64
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  return { nodeId, name: node.name, format, base64 };
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Whitelist of node fields that setProperty / bulkSetProperty may write
const SETTABLE_PROPERTIES = new Set([
  'name', 'visible', 'opacity', 'blendMode',
  'clipsContent', 'layoutMode', 'primaryAxisSizingMode', 'counterAxisSizingMode',
  'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'itemSpacing', 'counterAxisSpacing',
  'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
  'constraints', 'layoutAlign', 'layoutGrow', 'primaryAxisAlignItems', 'counterAxisAlignItems',
  'textAlignHorizontal', 'textAlignVertical', 'textAutoResize',
  'rotation', 'layoutWrap', 'layoutPositioning', 'itemReverseZIndex', 'strokesIncludedInLayout',
  'cornerSmoothing', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'textCase', 'textDecoration',
  'reactions', 'scrollBehavior', 'overflowDirection', 'flowStartingPoints'
]);

// Default font used as a fallback when a text node has mixed or unloadable fonts.
// Change this to match the primary font family in your document if Inter is not available.
const DEFAULT_FONT = { family: 'Inter', style: 'Regular' };

// Font loading cache — avoids redundant figma.loadFontAsync calls within a session
const _loadedFonts = new Set();
async function ensureFontLoaded(fontName) {
  const key = `${fontName.family}:${fontName.style}`;
  if (!_loadedFonts.has(key)) {
    await figma.loadFontAsync(fontName);
    _loadedFonts.add(key);
  }
}

// ─── Serialization ───────────────────────────────────────────────────────────

function isMixed(value) {
  return value === figma.mixed;
}

function serializeFills(fills) {
  if (!fills || isMixed(fills)) return [];
  return fills.map((fill) => {
    const f = { type: fill.type, visible: fill.visible !== undefined ? fill.visible : true, opacity: fill.opacity !== undefined ? fill.opacity : 1 };
    if (fill.type === 'SOLID') {
      f.color = {
        r: Math.round(fill.color.r * 255),
        g: Math.round(fill.color.g * 255),
        b: Math.round(fill.color.b * 255),
      };
      if (fill.boundVariables && fill.boundVariables.color) {
        f.colorVariableId = fill.boundVariables.color.id;
      }
    }
    return f;
  });
}

function serializeBoundVariables(node) {
  if (!node.boundVariables) return undefined;
  const result = {};
  for (const [key, binding] of Object.entries(node.boundVariables)) {
    if (!binding) continue;
    if (Array.isArray(binding)) {
      result[key] = binding.map((b) => b && b.id ? b.id : null);
    } else {
      result[key] = binding.id;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function serializeNode(node, depth) {
  const base = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if ('rotation' in node && node.rotation !== 0) base.rotation = node.rotation;
  if ('opacity' in node && node.opacity !== 1) base.opacity = node.opacity;
  if ('effects' in node && node.effects.length > 0) {
    base.effects = node.effects.map(e => ({ type: e.type, visible: e.visible !== false }));
  }
  if ('layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE') base.layoutPositioning = node.layoutPositioning;
  if ('layoutAlign' in node) base.layoutAlign = node.layoutAlign;
  if ('layoutGrow' in node) base.layoutGrow = node.layoutGrow;
  
  if ('reactions' in node && node.reactions.length > 0) {
    base.reactions = node.reactions;
  }
  
  if ('scrollBehavior' in node) {
    base.scrollBehavior = node.scrollBehavior;
  }
  if ('overflowDirection' in node) {
    base.overflowDirection = node.overflowDirection;
  }
  if (node.type === 'PAGE' && 'flowStartingPoints' in node) {
    base.flowStartingPoints = node.flowStartingPoints;
  }

  // TEXT
  if (node.type === 'TEXT') {
    base.text = node.characters;
    base.fontSize = isMixed(node.fontSize) ? null : node.fontSize;
    base.textAlignHorizontal = node.textAlignHorizontal;
    base.textAlignVertical = node.textAlignVertical;
    base.textAutoResize = node.textAutoResize;
    if (!isMixed(node.lineHeight)) base.lineHeight = node.lineHeight;
    if (!isMixed(node.letterSpacing)) base.letterSpacing = node.letterSpacing;
    if (!isMixed(node.paragraphSpacing)) base.paragraphSpacing = node.paragraphSpacing;
    if (!isMixed(node.textCase)) base.textCase = node.textCase;
    if (!isMixed(node.textDecoration)) base.textDecoration = node.textDecoration;
    
    if (!isMixed(node.fontName) && node.fontName) {
      base.fontFamily = node.fontName.family;
      base.fontWeight = node.fontName.style;
    }
    const tsId = node.textStyleId;
    base.textStyleId = isMixed(tsId) ? null : (tsId || null);
    if (base.textStyleId) {
      try {
        const s = figma.getStyleById(base.textStyleId);
        base.textStyleName = s ? s.name : null;
        if (s) {
           base.styleFontSize = s.fontSize;
           base.styleFontFamily = s.fontName ? s.fontName.family : null;
           base.styleFontWeight = s.fontName ? s.fontName.style : null;
        }
      } catch (e) { console.warn(`[Figlink] Could not resolve text style ${base.textStyleId}: ${e.message}`); }
    }
    base.fills = serializeFills(node.fills);
    const bv = serializeBoundVariables(node);
    if (bv) base.boundVariables = bv;
  }

  // Geometry / fills
  if (node.type !== 'TEXT' && 'fills' in node) {
    if (!isMixed(node.fills)) base.fills = serializeFills(node.fills);
    if (node.fillStyleId) base.fillStyleId = node.fillStyleId;
    const bv = serializeBoundVariables(node);
    if (bv) base.boundVariables = bv;
  }

  // Corner radius
  if ('cornerRadius' in node) {
    base.cornerRadius = isMixed(node.cornerRadius) ? null : node.cornerRadius;
    if ('cornerSmoothing' in node) {
      base.cornerSmoothing = node.cornerSmoothing;
    }
    if ('topLeftRadius' in node) {
      base.topLeftRadius = node.topLeftRadius;
      base.topRightRadius = node.topRightRadius;
      base.bottomRightRadius = node.bottomRightRadius;
      base.bottomLeftRadius = node.bottomLeftRadius;
    }
  }

  // Strokes
  if ('strokes' in node) {
    if (!isMixed(node.strokes)) base.strokes = serializeFills(node.strokes); // Re-use serializeFills for strokes
    if ('strokeWeight' in node) {
      base.strokeWeight = isMixed(node.strokeWeight) ? null : node.strokeWeight;
    }
  }

  // Auto-layout / padding
  if ('paddingTop' in node) {
    base.paddingTop = node.paddingTop;
    base.paddingRight = node.paddingRight;
    base.paddingBottom = node.paddingBottom;
    base.paddingLeft = node.paddingLeft;
    
    if ('primaryAxisAlignItems' in node && node.primaryAxisAlignItems === 'SPACE_BETWEEN') {
      base.itemSpacing = 'auto';
    } else {
      base.itemSpacing = node.itemSpacing;
    }
    
    if ('counterAxisAlignContent' in node && node.counterAxisAlignContent === 'SPACE_BETWEEN') {
      base.counterAxisSpacing = 'auto';
    } else {
      base.counterAxisSpacing = node.counterAxisSpacing !== undefined ? node.counterAxisSpacing : null;
    }
    
    if ('layoutWrap' in node) base.layoutWrap = node.layoutWrap;
    if ('itemReverseZIndex' in node && node.itemReverseZIndex) base.itemReverseZIndex = node.itemReverseZIndex;
    if ('strokesIncludedInLayout' in node && node.strokesIncludedInLayout) base.strokesIncludedInLayout = node.strokesIncludedInLayout;
  }

  // Recurse
  if (depth > 0 && 'children' in node) {
    base.children = node.children.map((c) => serializeNode(c, depth - 1));
  } else if ('children' in node) {
    base.childCount = node.children.length;
  }

  return base;
}

// ─── Commands ────────────────────────────────────────────────────────────────

function getNodes({ nodeId, depth = 3 }) {
  const root = nodeId ? figma.getNodeById(nodeId) : figma.currentPage;
  if (!root) throw new Error(`Node ${nodeId} not found`);
  return serializeNode(root, Math.max(0, depth));
}

function getNodesFlat({ nodeId, skipVectors = true, skipInstanceChildren = true }) {
  const root = nodeId ? figma.getNodeById(nodeId) : figma.currentPage;
  if (!root) throw new Error(`Node ${nodeId} not found`);

  const VECTOR_TYPES = new Set(['VECTOR', 'IMAGE', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'ELLIPSE', 'LINE']);
  const results = [];

  function walk(node, insideInstance, depth = 0) {
    if (depth > 100) return;
    const isVectorLike = VECTOR_TYPES.has(node.type);
    const isInstanceChild = node.id.includes(';');

    if (skipVectors && isVectorLike) return;
    if (skipInstanceChildren && isInstanceChild) return;

    results.push(serializeNode(node, 0));

    if ('children' in node) {
      const nowInsideInstance = insideInstance || node.type === 'INSTANCE';
      for (const child of node.children) {
        walk(child, nowInsideInstance, depth + 1);
      }
    }
  }

  if ('children' in root) {
    for (const child of root.children) walk(child, false);
  } else {
    walk(root, false);
  }

  return results;
}

function renameNode(nodeId, name) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  const oldName = node.name;
  node.name = name;
  return { ok: true, id: nodeId, oldName, newName: name };
}

function bulkRename(renames) {
  const results = [];
  for (const { nodeId, name } of renames) {
    try {
      results.push(renameNode(nodeId, name));
    } catch (e) {
      results.push({ ok: false, id: nodeId, error: e.message });
    }
  }
  return results;
}

function getLocalStyles() {
  const textStyles = figma.getLocalTextStyles().map((s) => ({
    id: s.id,
    name: s.name,
    fontSize: s.fontSize,
    fontWeight: s.fontName ? s.fontName.style : null,
    fontFamily: s.fontName ? s.fontName.family : null,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    leadingTrim: s.leadingTrim,
  }));

  const colorStyles = figma.getLocalPaintStyles().map((s) => ({
    id: s.id,
    name: s.name,
    paints: s.paints.map((p) => ({
      type: p.type,
      color: p.type === 'SOLID' ? {
        r: Math.round(p.color.r * 255),
        g: Math.round(p.color.g * 255),
        b: Math.round(p.color.b * 255),
      } : null,
    })),
  }));

  return { textStyles, colorStyles };
}

function serializeTextStyle(s) {
  return {
    id: s.id,
    key: s.key,
    name: s.name,
    fontSize: s.fontSize,
    fontWeight: s.fontName ? s.fontName.style : null,
    fontFamily: s.fontName ? s.fontName.family : null,
  };
}

// Returns all text styles available in the document — local + any library styles
// found in use on the current page (library styles aren't exposed via getLocalTextStyles).
function getAllAvailableStyles() {
  const stylesById = new Map();

  for (const s of figma.getLocalTextStyles()) {
    stylesById.set(s.id, serializeTextStyle(s));
  }

  // Walk the current page to discover any library text styles in use
  function walk(node) {
    if (node.type === 'TEXT') {
      const tsId = node.textStyleId;
      if (tsId && tsId !== figma.mixed && !stylesById.has(tsId)) {
        try {
          const s = figma.getStyleById(tsId);
          if (s) stylesById.set(tsId, serializeTextStyle(s));
        } catch (e) { /* style not resolvable — skip */ }
      }
    }
    if ('children' in node) {
      for (const child of node.children) walk(child);
    }
  }
  walk(figma.currentPage);

  return { textStyles: [...stylesById.values()] };
}

function getLocalVariables() {
  const collections = figma.variables.getLocalVariableCollections().map((c) => ({
    id: c.id,
    name: c.name,
    modes: c.modes,
    variableIds: c.variableIds,
  }));

  const variables = figma.variables.getLocalVariables().map((v) => ({
    id: v.id,
    key: v.key,
    name: v.name,
    resolvedType: v.resolvedType,
    collectionId: v.variableCollectionId,
    valuesByMode: v.valuesByMode,
  }));

  return { collections, variables };
}

async function getAllAvailableVariables() {
  // 1. Local variables (includes any already-imported library vars)
  const local = figma.variables.getLocalVariables().map((v) => ({
    id: v.id,
    name: v.name,
    resolvedType: v.resolvedType,
    collectionId: v.variableCollectionId,
    valuesByMode: v.valuesByMode,
  }));

  // 2. Library variables from all connected team libraries (parallelized in batches)
  const IMPORT_BATCH = 20;
  const libraryVars = [];
  try {
    const collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    for (const collection of collections) {
      const vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(collection.key);
      const targets = vars.filter(v => v.resolvedType === 'COLOR' || v.resolvedType === 'FLOAT');
      for (let i = 0; i < targets.length; i += IMPORT_BATCH) {
        const batch = targets.slice(i, i + IMPORT_BATCH);
        const results = await Promise.all(batch.map(async (libVar) => {
          try {
            const imported = await figma.variables.importVariableByKeyAsync(libVar.key);
            return {
              id: imported.id,
              name: libVar.name,
              resolvedType: libVar.resolvedType,
              collectionId: imported.variableCollectionId,
              valuesByMode: imported.valuesByMode,
            };
          } catch (e) {
            console.warn(`[Figlink] Could not import variable "${libVar.name}" (${libVar.key}): ${e.message}`);
            return null;
          }
        }));
        libraryVars.push(...results.filter(Boolean));
      }
    }
  } catch (e) { console.warn(`[Figlink] Could not fetch team library variable collections: ${e.message}`); }

  // Merge: local first, then library (deduplicate by id)
  const seen = new Set(local.map(v => v.id));
  const merged = [...local];
  for (const v of libraryVars) {
    if (!seen.has(v.id)) {
      seen.add(v.id);
      merged.push(v);
    }
  }
  return merged;
}

async function applyTextStyle(nodeId, styleId) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (node.type !== 'TEXT') throw new Error(`Node ${nodeId} is not a TEXT node (got ${node.type})`);

  const style = figma.getStyleById(styleId);
  if (!style) throw new Error(`Style ${styleId} not found`);

  // Ensure font is loaded before mutating
  const fontName = isMixed(node.fontName)
    ? DEFAULT_FONT
    : node.fontName;
  await ensureFontLoaded(fontName);

  node.textStyleId = styleId;
  return { ok: true, nodeId, styleId, styleName: style.name };
}

async function bulkApplyTextStyle(items) {
  const results = [];
  for (const { nodeId, styleId } of items) {
    try {
      results.push(await applyTextStyle(nodeId, styleId));
    } catch (e) {
      results.push({ ok: false, nodeId, error: e.message });
    }
  }
  return results;
}

// Import library text styles by key in batches, then apply to text nodes.
// items: [{ styleKey, nodeId }]
async function bulkApplyTextStyleByKey(items) {
  const BATCH = 15;
  const results = [];
  const keyToId = {};
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await Promise.all(batch.map(async (item) => {
      if (keyToId[item.styleKey] === undefined) {
        try {
          const s = await figma.importStyleByKeyAsync(item.styleKey);
          keyToId[item.styleKey] = s.id;
        } catch (e) {
          keyToId[item.styleKey] = null;
        }
      }
    }));
    for (const item of batch) {
      const styleId = keyToId[item.styleKey];
      if (!styleId) { results.push({ ok: false, nodeId: item.nodeId, error: 'style import failed' }); continue; }
      try { results.push(await applyTextStyle(item.nodeId, styleId)); }
      catch (e) { results.push({ ok: false, nodeId: item.nodeId, error: e.message }); }
    }
  }
  return results;
}

function applyFillStyle(nodeId, styleId, fillIndex) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  node.fillStyleId = styleId;
  return { ok: true, nodeId, styleId };
}

function applyFillVariable(nodeId, variableId, fillIndex) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (!('fills' in node)) throw new Error(`Node ${nodeId} does not support fills`);

  const variable = figma.variables.getVariableById(variableId);
  if (!variable) throw new Error(`Variable ${variableId} not found`);

  const fills = structuredClone(node.fills);
  if (!fills.length) fills.push({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } });

  if (fillIndex < 0 || fillIndex >= fills.length) {
    throw new Error(`fillIndex ${fillIndex} is out of bounds (node has ${fills.length} fill(s))`);
  }

  fills[fillIndex] = figma.variables.setBoundVariableForPaint(fills[fillIndex], 'color', variable);
  node.fills = fills;

  return { ok: true, nodeId, variableId, fillIndex };
}

function bulkApplyFillVariable(items) {
  const results = [];
  for (const { nodeId, variableId, fillIndex = 0 } of items) {
    try {
      results.push(applyFillVariable(nodeId, variableId, fillIndex));
    } catch (e) {
      results.push({ ok: false, nodeId, error: e.message });
    }
  }
  return results;
}

function setVariableBinding(nodeId, field, variableId) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const variable = figma.variables.getVariableById(variableId);
  if (!variable) throw new Error(`Variable ${variableId} not found`);

  node.setBoundVariable(field, variable);
  return { ok: true, nodeId, field, variableId, variableName: variable.name };
}

function bulkSetVariableBinding(items) {
  const results = [];
  for (const { nodeId, field, variableId } of items) {
    try {
      results.push(setVariableBinding(nodeId, field, variableId));
    } catch (e) {
      results.push({ ok: false, nodeId, field, error: e.message });
    }
  }
  return results;
}

// Import library variables by key in parallel batches, then apply fills.
// items: [{ variableKey, nodeId, fillIndex }]
async function bulkApplyFillVariableByKey(items) {
  const BATCH = 15;
  const results = [];
  // Deduplicate imports — cache key → imported variable id
  const keyToId = {};
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await Promise.all(batch.map(async (item) => {
      if (!keyToId[item.variableKey]) {
        try {
          const v = await figma.variables.importVariableByKeyAsync(item.variableKey);
          keyToId[item.variableKey] = v.id;
        } catch (e) {
          keyToId[item.variableKey] = null;
        }
      }
    }));
    for (const item of batch) {
      const varId = keyToId[item.variableKey];
      if (!varId) { results.push({ ok: false, nodeId: item.nodeId, error: 'import failed' }); continue; }
      try { results.push(applyFillVariable(item.nodeId, varId, item.fillIndex || 0)); }
      catch (e) { results.push({ ok: false, nodeId: item.nodeId, error: e.message }); }
    }
  }
  return results;
}

// Import library variables by key in parallel batches, then apply layout/radius bindings.
// items: [{ variableKey, nodeId, field }]
async function bulkSetVariableBindingByKey(items) {
  const BATCH = 15;
  const results = [];
  const keyToId = {};
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await Promise.all(batch.map(async (item) => {
      if (!keyToId[item.variableKey]) {
        try {
          const v = await figma.variables.importVariableByKeyAsync(item.variableKey);
          keyToId[item.variableKey] = v.id;
        } catch (e) {
          keyToId[item.variableKey] = null;
        }
      }
    }));
    for (const item of batch) {
      const varId = keyToId[item.variableKey];
      if (!varId) { results.push({ ok: false, nodeId: item.nodeId, error: 'import failed' }); continue; }
      try { results.push(setVariableBinding(item.nodeId, item.field, varId)); }
      catch (e) { results.push({ ok: false, nodeId: item.nodeId, error: e.message }); }
    }
  }
  return results;
}

function removeVariableBinding(nodeId, field) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  node.setBoundVariable(field, null);
  return { ok: true, nodeId, field };
}

function setProperty(nodeId, field, value) {
  if (!SETTABLE_PROPERTIES.has(field))
    throw new Error(`Property "${field}" is not in the allowed list`);
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  node[field] = value;
  return { ok: true, nodeId, field, value };
}

function bulkSetProperty(items) {
  const results = [];
  for (const { nodeId, field, value } of items) {
    try {
      results.push(setProperty(nodeId, field, value));
    } catch (e) {
      results.push({ ok: false, nodeId, field, error: e.message });
    }
  }
  return results;
}

function resolveVariables(ids) {
  return ids.map(id => {
    try {
      const v = figma.variables.getVariableById(id);
      if (!v) return { id, error: 'not found' };
      return { id, name: v.name, resolvedType: v.resolvedType, collectionId: v.variableCollectionId, valuesByMode: v.valuesByMode };
    } catch (e) {
      return { id, error: e.message };
    }
  });
}

function getAllDocumentVariables() {
  // Walk entire page collecting all variable IDs from boundVariables
  const varIds = new Set();
  function walk(node) {
    if (node.boundVariables) {
      Object.values(node.boundVariables).forEach(val => {
        if (Array.isArray(val)) val.forEach(v => v && v.id && varIds.add(v.id));
        else if (val && val.id) varIds.add(val.id);
      });
      if (node.fills && Array.isArray(node.fills)) {
        node.fills.forEach(f => {
          if (f.boundVariables && f.boundVariables.color) varIds.add(f.boundVariables.color.id);
        });
      }
    }
    if ('children' in node) node.children.forEach(walk);
  }
  walk(figma.currentPage);
  const resolved = [];
  varIds.forEach(id => {
    try {
      const v = figma.variables.getVariableById(id);
      if (v) resolved.push({ id, name: v.name, resolvedType: v.resolvedType, collectionId: v.variableCollectionId, valuesByMode: v.valuesByMode });
    } catch (e) { console.warn(`[Figlink] Could not resolve variable ${id}: ${e.message}`); }
  });
  return resolved;
}

async function setCharacters(nodeId, text) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (node.type !== 'TEXT') throw new Error(`Node ${nodeId} is not a TEXT node`);
  const fontName = isMixed(node.fontName) ? DEFAULT_FONT : node.fontName;
  await ensureFontLoaded(fontName);
  const oldText = node.characters;
  node.characters = text;
  return { ok: true, nodeId, oldText, newText: text };
}

async function bulkSetCharacters(items) {
  const results = [];
  for (const { nodeId, text } of items) {
    try {
      results.push(await setCharacters(nodeId, text));
    } catch (e) {
      results.push({ ok: false, nodeId, error: e.message });
    }
  }
  return results;
}

async function duplicateTextStyle(styleId, newName, overrides) {
  const src = figma.getStyleById(styleId);
  if (!src) throw new Error(`Style ${styleId} not found`);
  if (src.type !== 'TEXT') throw new Error(`Style ${styleId} is not a text style`);

  await ensureFontLoaded(DEFAULT_FONT);
  await ensureFontLoaded(src.fontName);

  const s = figma.createTextStyle();
  s.name = newName;
  s.fontSize = src.fontSize;
  s.fontName = src.fontName;
  s.lineHeight = src.lineHeight;
  s.letterSpacing = src.letterSpacing;
  s.paragraphSpacing = src.paragraphSpacing;
  s.paragraphIndent = src.paragraphIndent;
  s.textCase = src.textCase;
  s.textDecoration = src.textDecoration;
  s.leadingTrim = src.leadingTrim;

  for (const [field, value] of Object.entries(overrides)) {
    s[field] = value;
  }

  return { ok: true, newId: s.id, newName: s.name };
}

async function bulkDuplicateTextStyle(items) {
  const results = [];
  for (const { styleId, newName, overrides = {} } of items) {
    try {
      results.push(await duplicateTextStyle(styleId, newName, overrides));
    } catch (e) {
      results.push({ ok: false, styleId, error: e.message });
    }
  }
  return results;
}

async function setStyleProperty(styleId, field, value) {
  const style = figma.getStyleById(styleId);
  if (!style) throw new Error(`Style ${styleId} not found`);
  if (style.type === 'TEXT' && style.fontName) {
    await figma.loadFontAsync(style.fontName);
  }
  style[field] = value;
  return { ok: true, styleId, field, value };
}

async function bulkSetStyleProperty(items) {
  const results = [];
  for (const { styleId, field, value } of items) {
    try {
      results.push(await setStyleProperty(styleId, field, value));
    } catch (e) {
      results.push({ ok: false, styleId, field, error: e.message });
    }
  }
  return results;
}

function deleteStyle(styleId) {
  const style = figma.getStyleById(styleId);
  if (!style) throw new Error(`Style ${styleId} not found`);
  style.remove();
  return { ok: true, styleId };
}

function bulkDeleteStyle(styleIds) {
  const results = [];
  for (const styleId of styleIds) {
    try {
      results.push(deleteStyle(styleId));
    } catch (e) {
      results.push({ ok: false, styleId, error: e.message });
    }
  }
  return results;
}

async function setStyleVariableBinding(styleId, field, variableId) {
  const style = figma.getStyleById(styleId);
  if (!style) throw new Error(`Style ${styleId} not found`);
  if (style.type === 'TEXT' && style.fontName) {
    await figma.loadFontAsync(style.fontName);
  }
  const variable = figma.variables.getVariableById(variableId);
  if (!variable) throw new Error(`Variable ${variableId} not found`);
  style.setBoundVariable(field, variable);
  return { ok: true, styleId, field, variableId };
}

async function bulkSetStyleVariableBinding(items) {
  const results = [];
  for (const { styleId, field, variableId } of items) {
    try {
      results.push(await setStyleVariableBinding(styleId, field, variableId));
    } catch (e) {
      results.push({ ok: false, styleId, field, error: e.message });
    }
  }
  return results;
}

function cloneComponentSet(nodeId, newName, optionsToKeep, height, parentFrameId) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (node.type !== 'COMPONENT_SET') throw new Error(`Node ${nodeId} is not a COMPONENT_SET`);

  // Clone the component set
  const clone = node.clone();
  clone.name = newName;
  
  if (parentFrameId) {
    const parentNode = figma.getNodeById(parentFrameId);
    if (parentNode && ('appendChild' in parentNode)) {
       parentNode.appendChild(clone);
    }
  } else {
    clone.y = node.y + node.height + 100; // Position it below the original
  }

  // Filter children (components)
  if (optionsToKeep) {
    const childrenToRemove = [];
    for (const child of clone.children) {
      if (child.type === 'COMPONENT') {
        // Parse variant properties from the name (e.g. "Property 1=Default, Size=Large")
        let keep = true;
        // Split by comma but be careful about spaces around the equals sign
        const props = child.name.split(',').map(s => s.trim());
        
        for (const [key, val] of Object.entries(optionsToKeep)) {
          // Check if the property array has an entry starting with "Key=" or "Key =" and ending with val (case insensitive to be safe)
          const hasProp = props.some(p => {
             const parts = p.split('=');
             if (parts.length !== 2) return false;
             return parts[0].trim().toLowerCase() === key.toLowerCase() && parts[1].trim().toLowerCase() === val.toLowerCase();
          });
          
          if (!hasProp) {
            keep = false;
            break;
          }
        }
        
        if (!keep) {
          childrenToRemove.push(child);
        } else {
          // Rename the component to remove the filtered property since it's now constant
          const newProps = props.filter(p => {
             const parts = p.split('=');
             if (parts.length !== 2) return true;
             return !Object.keys(optionsToKeep).some(k => k.toLowerCase() === parts[0].trim().toLowerCase());
          });
          
          // Resize the component
          if (height) {
            try {
              child.resize(child.width, height);
              // if it's an auto-layout frame, we might need to set its height to FIXED to override hug contents
              if (child.layoutMode !== 'NONE') {
                child.primaryAxisSizingMode = 'FIXED';
                child.counterAxisSizingMode = 'FIXED';
                child.resize(child.width, height);
              }
            } catch(e) {
               // ignore resize errors on complex components
            }
          }
          
          try {
             child.name = newProps.join(', ') || 'Default';
          } catch(e) {}
        }
      }
    }
    
    // To avoid Figma destroying the set due to variant conflict or sudden deletions:
    // Let's NOT delete the nodes immediately. Let's just group them and hide them,
    // or rename them to "DELETE_ME" so you can manually delete them, ensuring the engine doesn't crash.
    childrenToRemove.forEach(c => {
       try { 
          c.name = "DELETE_ME";
          c.visible = false;
       } catch(e) {}
    });
  }

  return { ok: true, oldId: nodeId, newId: clone.id, newName: clone.name };
}

async function swapButtonInstances(containerId, newComponentSetId) {
  const container = figma.getNodeById(containerId);
  if (!container) throw new Error(`Container ${containerId} not found`);

  // Try importing the component set
  let newSet;
  try {
    newSet = await figma.importComponentSetByKeyAsync(newComponentSetId);
  } catch (e) {
    // Fallback: assume it's in the same file and the ID was passed
    newSet = figma.getNodeById(newComponentSetId);
  }

  if (!newSet || newSet.type !== 'COMPONENT_SET') {
    throw new Error(`New component set ${newComponentSetId} not found or not a COMPONENT_SET`);
  }

  const results = [];
  
  // Find all instances that look like buttons
  const instances = container.findAll(n => n.type === 'INSTANCE' && n.name.toLowerCase().includes('button'));
  
  for (const instance of instances) {
    try {
      // Find the text content of the old button
      const oldTextNode = instance.findOne(n => n.type === 'TEXT');
      const oldText = oldTextNode ? oldTextNode.characters : null;
      
      // Determine variant properties to match
      const oldVariantProps = instance.componentProperties;
      let newVariantProps = {};
      
      if (oldVariantProps) {
         // Attempt to map variant properties. Adjust keys as needed based on the design system.
         // Default mappings, prioritizing Variant/State
         for (const [key, prop] of Object.entries(oldVariantProps)) {
             if (prop.type === 'VARIANT') {
                 // Convert key to new naming convention if necessary or keep as is
                 // Example: mapping 'State' to 'State', 'Variant' to 'Variant'
                 newVariantProps[key] = prop.value;
             }
         }
      }
      
      // Find the matching component in the new set
      let targetComponent = newSet.defaultVariant;
      
      if (Object.keys(newVariantProps).length > 0) {
         // Try to find an exact match
         const match = newSet.children.find(c => {
             if (c.type !== 'COMPONENT' || c.name === 'DELETE_ME') return false;
             
             const cProps = {};
             c.name.split(',').forEach(p => {
                 const [k, v] = p.split('=').map(s => s.trim());
                 if (k && v) cProps[k] = v;
             });
             
             // Check if all requested props match
             for (const [k, v] of Object.entries(newVariantProps)) {
                 if (cProps[k] && cProps[k] !== v) return false;
             }
             return true;
         });
         
         if (match) targetComponent = match;
      }
      
      if (!targetComponent) {
          results.push({ ok: false, id: instance.id, error: 'Target component variant not found' });
          continue;
      }
      
      // Swap the instance
      instance.swapComponent(targetComponent);
      
      // Make it stretch to fill container horizontally
      if (instance.parent && instance.parent.layoutMode !== 'NONE') {
         instance.layoutAlign = 'STRETCH';
      } else {
         // If parent is not auto-layout, maybe stretch width to match parent width minus padding
         // For now, just set constraints
         instance.constraints = { horizontal: 'STRETCH', vertical: 'MIN' };
      }
      
      // Restore the text
      if (oldText) {
          const newTextNode = instance.findOne(n => n.type === 'TEXT');
          if (newTextNode) {
              const fontName = isMixed(newTextNode.fontName) ? DEFAULT_FONT : newTextNode.fontName;
              await ensureFontLoaded(fontName);
              newTextNode.characters = oldText;
          }
      }
      
      // Apply new naming convention to the instance name
      instance.name = instance.name.toLowerCase().replace(/\s+/g, '-');
      
      results.push({ ok: true, id: instance.id, name: instance.name });
    } catch (e) {
      results.push({ ok: false, id: instance.id, error: e.message });
    }
  }

  return results;
}

// ─── Node Creation ────────────────────────────────────────────────────────────

function makeFill(f) {
  if (f.type === 'SOLID') {
    const fill = { type: 'SOLID', color: { r: f.r / 255, g: f.g / 255, b: f.b / 255 } };
    if (f.opacity !== undefined) fill.opacity = f.opacity;
    return fill;
  }
  return f;
}

function makeStroke(s) {
  if (s.type === 'SOLID') {
    const stroke = { type: 'SOLID', color: { r: s.r / 255, g: s.g / 255, b: s.b / 255 } };
    if (s.opacity !== undefined) stroke.opacity = s.opacity;
    return stroke;
  }
  return s;
}

async function applyNodeProps(node, props) {
  // Load font before any text operations
  if (node.type === 'TEXT') {
    const fn = props.fontName || DEFAULT_FONT;
    await ensureFontLoaded(fn);
    node.fontName = fn;
  }

  const SKIP = new Set(['type', 'children', 'fontName']);

  for (const [key, value] of Object.entries(props)) {
    if (SKIP.has(key)) continue;
    try {
      if (key === 'itemSpacing' && value === 'auto') {
        node.primaryAxisAlignItems = 'SPACE_BETWEEN';
      } else if (key === 'itemSpacing' && typeof value === 'number') {
        node.primaryAxisAlignItems = 'MIN'; // Or default, but need to reset if it was auto
        node.itemSpacing = value;
      } else if (key === 'fills') {
        node.fills = value.map(makeFill);
      } else if (key === 'strokes') {
        node.strokes = value.map(makeStroke);
      } else if (key === 'characters') {
        const fn = isMixed(node.fontName) ? DEFAULT_FONT : node.fontName;
        await ensureFontLoaded(fn);
        node.characters = value;
      } else if (key === 'effects') {
        node.effects = value;
      } else if (key === 'reactions') {
        await node.setReactionsAsync(value);
      } else if (key === 'strokeWeight') {
        node.strokeWeight = value;
      } else if (key === 'strokeAlign') {
        node.strokeAlign = value;
      } else if (key === 'x' || key === 'y') {
        node[key] = value;
      } else if (key === 'width' || key === 'height') {
        if ('resize' in node) {
          const w = key === 'width' ? value : node.width;
          const h = key === 'height' ? value : node.height;
          node.resize(w, h);
        }
      } else if (key in node) {
        node[key] = value;
      }
    } catch (e) {
      console.warn(`[Figlink] applyNodeProps: could not set "${key}": ${e.message}`);
    }
  }

  // Apply width/height together to lock in final size
  if ('width' in props && 'height' in props && 'resize' in node) {
    try { node.resize(props.width, props.height); } catch (e) {}
  }
}

function instantiateNode(type) {
  switch (type) {
    case 'FRAME':     return figma.createFrame();
    case 'COMPONENT': return figma.createComponent();
    case 'RECTANGLE': return figma.createRectangle();
    case 'ELLIPSE':   return figma.createEllipse();
    case 'LINE':      return figma.createLine();
    case 'TEXT':      return figma.createText();
    case 'VECTOR':    return figma.createVector();
    default: throw new Error(`Unsupported node type: ${type}`);
  }
}

async function createNode({ type, parentId, props = {} }) {
  const parent = parentId ? figma.getNodeById(parentId) : figma.currentPage;
  if (!parent) throw new Error(`Parent ${parentId} not found`);
  const node = instantiateNode(type);
  if ('appendChild' in parent) parent.appendChild(node);
  await applyNodeProps(node, props);
  return { id: node.id, name: node.name, type: node.type };
}

async function setNodeRaw({ nodeId, props = {} }) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  await applyNodeProps(node, props);
  return { ok: true, nodeId };
}

async function createNodeTree({ tree, parentId }) {
  const parent = parentId ? figma.getNodeById(parentId) : figma.currentPage;
  if (!parent) throw new Error(`Parent ${parentId} not found`);

  const idMap = {}; // name → id

  async function build(def, parentNode) {
    const type = def.type;
    const children = def.children || [];
    const props = {};
    for (const k in def) {
      if (k !== 'type' && k !== 'children') props[k] = def[k];
    }
    const node = instantiateNode(type);
    if ('appendChild' in parentNode) parentNode.appendChild(node);
    await applyNodeProps(node, props);
    if (props.name) idMap[props.name] = node.id;
    for (const child of children) {
      await build(child, node);
    }
    return node;
  }

  const defs = Array.isArray(tree) ? tree : [tree];
  for (const def of defs) {
    await build(def, parent);
  }

  return idMap;
}

function deleteNode(nodeId) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  node.remove();
  return { ok: true, nodeId };
}

function groupAsComponentSet(nodeIds, name, parentId) {
  const nodes = nodeIds.map(id => {
    const n = figma.getNodeById(id);
    if (!n) throw new Error(`Node ${id} not found`);
    if (n.type !== 'COMPONENT') throw new Error(`Node ${id} is not a COMPONENT (got ${n.type})`);
    return n;
  });
  const set = figma.combineAsVariants(nodes, parentId ? figma.getNodeById(parentId) : figma.currentPage);
  set.name = name;
  return { ok: true, id: set.id, name: set.name };
}
