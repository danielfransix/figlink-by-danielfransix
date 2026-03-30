// Figma Plugin Main Thread — Figlink
// Communicates with ui.html via postMessage, which relays over WebSocket to the link server.

figma.showUI(__html__, { width: 500, height: 300, title: 'Figlink' });

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

    case 'bulk_set_variable_binding':
      return bulkSetVariableBinding(params.items);

    case 'bulk_apply_fill_variable':
      return bulkApplyFillVariable(params.items);

    case 'bulk_set_property':
      return bulkSetProperty(params.items);

    case 'set_style_property':
      return setStyleProperty(params.styleId, params.field, params.value);

    case 'bulk_set_style_property':
      return bulkSetStyleProperty(params.items);

    case 'duplicate_text_style':
      return duplicateTextStyle(params.styleId, params.newName, params.overrides || {});

    case 'bulk_duplicate_text_style':
      return bulkDuplicateTextStyle(params.items);

    case 'clone_component_set':
      return cloneComponentSet(params.nodeId, params.newName, params.optionsToKeep, params.height, params.parentFrameId);

    case 'swap_button_instances':
      return swapButtonInstances(params.containerId, params.newComponentSetId);

    default:
      throw new Error(`Unknown command: ${command}`);
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

  // TEXT
  if (node.type === 'TEXT') {
    base.text = node.characters;
    base.fontSize = isMixed(node.fontSize) ? null : node.fontSize;
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
      } catch (_) {}
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
    if ('topLeftRadius' in node) {
      base.topLeftRadius = node.topLeftRadius;
      base.topRightRadius = node.topRightRadius;
      base.bottomRightRadius = node.bottomRightRadius;
      base.bottomLeftRadius = node.bottomLeftRadius;
    }
  }

  // Auto-layout / padding
  if ('paddingTop' in node) {
    base.paddingTop = node.paddingTop;
    base.paddingRight = node.paddingRight;
    base.paddingBottom = node.paddingBottom;
    base.paddingLeft = node.paddingLeft;
    base.itemSpacing = node.itemSpacing;
    base.counterAxisSpacing = node.counterAxisSpacing !== undefined ? node.counterAxisSpacing : null;
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
  return serializeNode(root, depth);
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

function getLocalVariables() {
  const collections = figma.variables.getLocalVariableCollections().map((c) => ({
    id: c.id,
    name: c.name,
    modes: c.modes,
    variableIds: c.variableIds,
  }));

  const variables = figma.variables.getLocalVariables().map((v) => ({
    id: v.id,
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

  // 2. Library variables from all connected team libraries
  const libraryVars = [];
  try {
    const collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    for (const collection of collections) {
      const vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(collection.key);
      for (const libVar of vars) {
        // Only import COLOR and FLOAT — BOOLEAN/STRING aren't needed for standardization
        if (libVar.resolvedType !== 'COLOR' && libVar.resolvedType !== 'FLOAT') continue;
        try {
          const imported = await figma.variables.importVariableByKeyAsync(libVar.key);
          libraryVars.push({
            id: imported.id,
            name: libVar.name,
            resolvedType: libVar.resolvedType,
            collectionId: imported.variableCollectionId,
            valuesByMode: imported.valuesByMode,
          });
        } catch (_) {}
      }
    }
  } catch (_) {}

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
    ? { family: 'Inter', style: 'Regular' }
    : node.fontName;
  await figma.loadFontAsync(fontName);

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

function removeVariableBinding(nodeId, field) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  node.setBoundVariable(field, null);
  return { ok: true, nodeId, field };
}

function setProperty(nodeId, field, value) {
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
    } catch (_) {}
  });
  return resolved;
}

async function setCharacters(nodeId, text) {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  if (node.type !== 'TEXT') throw new Error(`Node ${nodeId} is not a TEXT node`);
  const fontName = isMixed(node.fontName) ? { family: 'Inter', style: 'Regular' } : node.fontName;
  await figma.loadFontAsync(fontName);
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

  await figma.loadFontAsync(src.fontName);

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
              const fontName = isMixed(newTextNode.fontName) ? { family: 'Inter', style: 'Regular' } : newTextNode.fontName;
              await figma.loadFontAsync(fontName);
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
