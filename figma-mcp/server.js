const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { randomUUID } = require('crypto');
const http = require('http');
const { z } = require('zod');
const { bridge } = require('./bridge.js');

const PORT = parseInt(process.env.PORT || '39399', 10);

const transports = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function run(command, params, extra) {
  const overrides = extra || {};
  const fileKey = overrides.fileKey || params?.fileKey || null;
  const timeoutMs = overrides.timeoutMs || null;
  const cmdParams = { ...(params || {}) };
  delete cmdParams.fileKey;
  return bridge.sendCommand(command, cmdParams, fileKey, timeoutMs);
}

function jsonContent(result) {
  return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
}

function imageContent(result) {
  return {
    content: [
      { type: 'image', data: result.data, mimeType: result.mimeType },
      { type: 'text', text: JSON.stringify(result.metadata, null, 2) },
    ],
  };
}

function mixedContent(result) {
  const items = result.items.map((item) => {
    if (item.type === 'image') {
      return { type: 'image', data: item.data, mimeType: item.mimeType };
    }
    return { type: 'text', text: typeof item.content === 'string' ? item.content : JSON.stringify(item.content, null, 2) };
  });
  return { content: items };
}

function formatResult(result) {
  if (result && result.__figlink_result_type === 'image') return imageContent(result);
  if (result && result.__figlink_result_type === 'mixed') return mixedContent(result);
  return jsonContent(result);
}

function createMcpServer() {
  const server = new McpServer({
    name: 'figlink-mcp',
    version: '1.0.0',
    description: 'Control Figma via Figlink — read and write your design files in real time through AI.',
  });

  // ─── Connection & Navigation ─────────────────────────────────────────────────

  server.tool(
  'figma_ping',
  'Check if Figlink is connected and the Figma plugin is running. Returns file name and current page.',
  { fileKey: z.string().optional().describe('Target a specific Figma file by its key') },
  async (params) => jsonContent(await run('ping', params))
);

server.tool(
  'figma_list_connected_files',
  'List all Figma files that currently have the Figlink plugin connected.',
  {},
  async () => jsonContent(await run('list_connected_files', {}))
);

server.tool(
  'figma_parse_link',
  'Parse a Figma URL into its fileKey and nodeId components.',
  { url: z.string().describe('Figma URL to parse') },
  async (params) => {
    try {
      const u = new URL(params.url);
      if (!u.hostname.includes('figma.com')) throw new Error('Not a Figma URL');
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex(p => p === 'design' || p === 'file' || p === 'proto');
      const fileKey = idx !== -1 ? parts[idx + 1] : null;
      let nodeId = u.searchParams.get('node-id');
      if (nodeId) {
        nodeId = decodeURIComponent(nodeId);
        if (!nodeId.includes(':')) nodeId = nodeId.replace('-', ':');
      }
      return jsonContent({ fileKey, nodeId: nodeId || null });
    } catch (e) {
      return jsonContent({ error: e.message });
    }
  }
);

server.tool(
  'figma_get_pages',
  'List all pages in the Figma document.',
  { fileKey: z.string().optional().describe('Target a specific Figma file by its key') },
  async (params) => jsonContent(await run('get_pages', params))
);

server.tool(
  'figma_set_current_page',
  'Switch the active page in Figma.',
  {
    pageId: z.string().describe('ID of the page to switch to'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('set_current_page', params))
);

server.tool(
  'figma_get_page_frames',
  'Get all top-level frames on the current page.',
  { fileKey: z.string().optional().describe('Target a specific Figma file by its key') },
  async (params) => jsonContent(await run('get_page_frames', params))
);

// ─── Reading Nodes ───────────────────────────────────────────────────────────

server.tool(
  'figma_get_selection',
  'Get the currently selected nodes with their properties up to depth 3.',
  { fileKey: z.string().optional().describe('Target a specific Figma file by its key') },
  async (params) => jsonContent(await run('get_selection', params))
);

server.tool(
  'figma_get_nodes',
  'Get a node tree by ID. Returns the node and its children up to the specified depth.',
  {
    nodeId: z.string().describe('ID of the root node to read'),
    depth: z.number().optional().default(3).describe('How many levels deep to recurse (default: 3)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('get_nodes', params))
);

server.tool(
  'figma_get_nodes_flat',
  'Get a flat list of all nodes in a subtree (useful for scanning large structures).',
  {
    nodeId: z.string().describe('ID of the root node to scan'),
    skipVectors: z.boolean().optional().default(true).describe('Skip vector/image/boolean nodes'),
    skipInstanceChildren: z.boolean().optional().default(true).describe('Skip children inside instances'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('get_nodes_flat', params))
);

// ─── Renaming ────────────────────────────────────────────────────────────────

server.tool(
  'figma_rename_node',
  'Rename one or more nodes. Pass an items array with { nodeId, name } objects.',
  {
    items: z.array(z.object({
      nodeId: z.string(),
      name: z.string(),
    })).describe('Array of { nodeId, name } objects'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('bulk_rename', { renames: params.items, fileKey: params.fileKey }))
);

// ─── Text Content ────────────────────────────────────────────────────────────

server.tool(
  'figma_set_characters',
  'Set text content on one or more text nodes. Pass an items array with { nodeId, text } objects.',
  {
    items: z.array(z.object({
      nodeId: z.string(),
      text: z.string(),
    })).describe('Array of { nodeId, text } objects'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('bulk_set_characters', { items: params.items, fileKey: params.fileKey }))
);

// ─── Text Styles ─────────────────────────────────────────────────────────────

server.tool(
  'figma_apply_text_style',
  'Apply text styles to one or more nodes. Each item can use styleId (local) or styleKey (team library). Use styleKey for library styles that need importing.',
  {
    items: z.array(z.object({
      nodeId: z.string(),
      styleId: z.string().optional().describe('Local text style ID'),
      styleKey: z.string().optional().describe('Library style key (team library) — use this instead of styleId for imported styles'),
    })).describe('Array of { nodeId, styleId?, styleKey? } objects'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => {
    const local = params.items.filter(i => i.styleKey === undefined || i.styleKey === null);
    const byKey = params.items.filter(i => i.styleKey !== undefined && i.styleKey !== null);
    const results = [];
    if (local.length > 0) {
      const r = await run('bulk_apply_text_style', { items: local, fileKey: params.fileKey });
      if (Array.isArray(r)) results.push(...r);
    }
    if (byKey.length > 0) {
      const r = await run('bulk_apply_text_style_by_key', { items: byKey, fileKey: params.fileKey });
      if (Array.isArray(r)) results.push(...r);
    }
    return jsonContent(results);
  }
);

// ─── Colors & Fills ──────────────────────────────────────────────────────────

server.tool(
  'figma_apply_fill_style',
  'Apply a paint/fill style to a node.',
  {
    nodeId: z.string().describe('ID of the node'),
    styleId: z.string().describe('ID of the paint style to apply'),
    fillIndex: z.number().optional().default(0).describe('Which fill slot to apply to (default: 0)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('apply_fill_style', params))
);

server.tool(
  'figma_apply_fill_variable',
  'Bind variables to fill colors on one or more nodes. Each item can use variableId (local) or variableKey (team library).',
  {
    items: z.array(z.object({
      nodeId: z.string(),
      variableId: z.string().optional().describe('Local variable ID'),
      variableKey: z.string().optional().describe('Library variable key — use this instead of variableId for imported variables'),
      fillIndex: z.number().optional().default(0).describe('Which fill slot (default: 0)'),
    })).describe('Array of { nodeId, variableId?, variableKey?, fillIndex? } objects'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => {
    const local = params.items.filter(i => i.variableKey === undefined || i.variableKey === null);
    const byKey = params.items.filter(i => i.variableKey !== undefined && i.variableKey !== null);
    const results = [];
    if (local.length > 0) {
      const r = await run('bulk_apply_fill_variable', { items: local, fileKey: params.fileKey });
      if (Array.isArray(r)) results.push(...r);
    }
    if (byKey.length > 0) {
      const r = await run('bulk_apply_fill_variable_by_key', { items: byKey, fileKey: params.fileKey });
      if (Array.isArray(r)) results.push(...r);
    }
    return jsonContent(results);
  }
);

// ─── Variable Bindings ───────────────────────────────────────────────────────

server.tool(
  'figma_set_variable_binding',
  'Bind variables to node properties on one or more nodes. Each item can use variableId (local) or variableKey (team library).',
  {
    items: z.array(z.object({
      nodeId: z.string(),
      field: z.string().describe('Property to bind (e.g. cornerRadius, strokeWeight, opacity)'),
      variableId: z.string().optional().describe('Local variable ID'),
      variableKey: z.string().optional().describe('Library variable key — use this instead of variableId for imported variables'),
    })).describe('Array of { nodeId, field, variableId?, variableKey? } objects'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => {
    const local = params.items.filter(i => i.variableKey === undefined || i.variableKey === null);
    const byKey = params.items.filter(i => i.variableKey !== undefined && i.variableKey !== null);
    const results = [];
    if (local.length > 0) {
      const r = await run('bulk_set_variable_binding', { items: local, fileKey: params.fileKey });
      if (Array.isArray(r)) results.push(...r);
    }
    if (byKey.length > 0) {
      const r = await run('bulk_set_variable_binding_by_key', { items: byKey, fileKey: params.fileKey });
      if (Array.isArray(r)) results.push(...r);
    }
    return jsonContent(results);
  }
);

server.tool(
  'figma_remove_variable_binding',
  'Remove a variable binding from a node property.',
  {
    nodeId: z.string().describe('ID of the node'),
    field: z.string().describe('Property to unbind'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('remove_variable_binding', params))
);

server.tool(
  'figma_import_variables_by_key',
  'Pre-import library variables by key. Returns a key-to-localId map.',
  {
    keys: z.array(z.string()).describe('Array of library variable keys to import'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('import_variables_by_key', params))
);

// ─── Node Properties ─────────────────────────────────────────────────────────

server.tool(
  'figma_set_property',
  'Set properties on one or more nodes. Supported fields: name, visible, opacity, blendMode, clipsContent, layoutMode, padding*, itemSpacing, cornerRadius, cornerSmoothing, rotation, constraints, reactions, and more.',
  {
    items: z.array(z.object({
      nodeId: z.string(),
      field: z.string().describe('Property name to set'),
      value: z.any().describe('New value for the property'),
    })).describe('Array of { nodeId, field, value } objects'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('bulk_set_property', { items: params.items, fileKey: params.fileKey }))
);

// ─── Styles (Paint & Text) ───────────────────────────────────────────────────

server.tool(
  'figma_get_local_styles',
  'Get all local text and paint styles in the document.',
  { fileKey: z.string().optional().describe('Target a specific Figma file by its key') },
  async (params) => jsonContent(await run('get_local_styles', params))
);

server.tool(
  'figma_get_all_available_styles',
  'Get all text styles available in the document (local + library styles in use).',
  { fileKey: z.string().optional().describe('Target a specific Figma file by its key') },
  async (params) => jsonContent(await run('get_all_available_styles', params))
);

server.tool(
  'figma_duplicate_text_style',
  'Duplicate one or more text styles with optional overrides.',
  {
    items: z.array(z.object({
      styleId: z.string().describe('ID of the source text style'),
      newName: z.string().describe('Name for the new style'),
      overrides: z.record(z.string(), z.any()).optional().default({}).describe('Property overrides for the new style'),
    })).describe('Array of { styleId, newName, overrides? } objects'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('bulk_duplicate_text_style', { items: params.items, fileKey: params.fileKey }))
);

server.tool(
  'figma_set_style_property',
  'Set properties on one or more paint or text styles.',
  {
    items: z.array(z.object({
      styleId: z.string().describe('ID of the style'),
      field: z.string().describe('Property name'),
      value: z.any().describe('New value'),
    })).describe('Array of { styleId, field, value } objects'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('bulk_set_style_property', { items: params.items, fileKey: params.fileKey }))
);

server.tool(
  'figma_set_style_variable_binding',
  'Bind variables to style properties on one or more styles.',
  {
    items: z.array(z.object({
      styleId: z.string().describe('ID of the style'),
      field: z.string().describe('Property to bind'),
      variableId: z.string().describe('ID of the variable'),
    })).describe('Array of { styleId, field, variableId } objects'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('bulk_set_style_variable_binding', { items: params.items, fileKey: params.fileKey }))
);

server.tool(
  'figma_delete_style',
  'Delete one or more paint or text styles.',
  {
    styleIds: z.array(z.string()).describe('Array of style IDs to delete'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('bulk_delete_style', { styleIds: params.styleIds, fileKey: params.fileKey }))
);

// ─── Variables ───────────────────────────────────────────────────────────────

server.tool(
  'figma_get_local_variables',
  'Get all local variable collections and their variables.',
  { fileKey: z.string().optional().describe('Target a specific Figma file by its key') },
  async (params) => jsonContent(await run('get_local_variables', params))
);

server.tool(
  'figma_get_all_available_variables',
  'Get all variables available (local + imported from team libraries). Note: may trigger library variable imports.',
  { fileKey: z.string().optional().describe('Target a specific Figma file by its key') },
  async (params) => jsonContent(await run('get_all_available_variables', params))
);

server.tool(
  'figma_get_all_document_variables',
  'Get all variables actually used in the current document by walking the page.',
  { fileKey: z.string().optional().describe('Target a specific Figma file by its key') },
  async (params) => jsonContent(await run('get_all_document_variables', params))
);

server.tool(
  'figma_resolve_variables',
  'Resolve variable IDs to their names, types, and values.',
  {
    ids: z.array(z.string()).describe('Array of variable IDs to resolve'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('resolve_variables', params))
);

// ─── Node Creation & Deletion ────────────────────────────────────────────────

server.tool(
  'figma_create_node',
  'Create a single node (FRAME, COMPONENT, RECTANGLE, ELLIPSE, LINE, TEXT, VECTOR) with properties.',
  {
    type: z.enum(['FRAME', 'COMPONENT', 'RECTANGLE', 'ELLIPSE', 'LINE', 'TEXT', 'VECTOR']).describe('Type of node to create'),
    parentId: z.string().optional().describe('ID of parent node (defaults to current page)'),
    props: z.record(z.string(), z.any()).optional().default({}).describe('Properties to set on the new node'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('create_node', params))
);

server.tool(
  'figma_create_node_tree',
  'Create a tree of nodes from a JSON definition. Each node needs type + props; children go in a children array. Returns a name→id map.',
  {
    tree: z.any().describe('Node tree definition — an object or array of objects with type, optional children array, and any props'),
    parentId: z.string().optional().describe('ID of parent node (defaults to current page)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('create_node_tree', params))
);

server.tool(
  'figma_set_node_raw',
  'Update arbitrary properties on an existing node. Handles fills, strokes, reactions, resizing, etc.',
  {
    nodeId: z.string().describe('ID of the node to update'),
    props: z.record(z.string(), z.any()).describe('Properties to set'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('set_node_raw', params))
);

server.tool(
  'figma_delete_node',
  'Delete a node from the document.',
  {
    nodeId: z.string().describe('ID of the node to delete'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('delete_node', params))
);

// ─── Structure Operations ────────────────────────────────────────────────────

server.tool(
  'figma_group_as_component_set',
  'Combine multiple components into a component set (variants).',
  {
    nodeIds: z.array(z.string()).describe('Array of COMPONENT node IDs to combine'),
    name: z.string().describe('Name for the new component set'),
    parentId: z.string().optional().describe('ID of parent frame'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('group_as_component_set', params))
);

server.tool(
  'figma_flatten_node',
  'Flatten a frame/group: move its children up to the parent and delete the container.',
  {
    nodeId: z.string().describe('ID of the node to flatten'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('flatten_node', params))
);

// ─── Component Operations ────────────────────────────────────────────────────

server.tool(
  'figma_clone_component_set',
  'Clone a component set, optionally filtering variants and setting height.',
  {
    nodeId: z.string().describe('ID of the COMPONENT_SET to clone'),
    newName: z.string().describe('Name for the cloned component set'),
    optionsToKeep: z.record(z.string(), z.string()).optional().describe('Variant properties to filter (e.g. {"Size": "Large"})'),
    height: z.number().optional().describe('Fixed height for kept variants'),
    parentFrameId: z.string().optional().describe('ID of parent frame to place the clone in'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('clone_component_set', params))
);

server.tool(
  'figma_swap_instances',
  'Find all instances whose name matches a pattern in a container and swap them to a new component set, preserving text.',
  {
    containerId: z.string().describe('ID of the container to search for instances'),
    newComponentSetId: z.string().describe('ID or key of the new component set to swap to'),
    searchPattern: z.string().optional().default('button').describe('Substring to match in instance names (case-insensitive). Default: "button". Use empty string "" to match ALL instances.'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('swap_instances', params))
);

// ─── Instance Override Reset ─────────────────────────────────────────────────

server.tool(
  'figma_reset_instance_spacing',
  'Reset spacing overrides on all auto-layout instances in a subtree to match their master components.',
  {
    nodeId: z.string().optional().describe('ID of the root node to scan (defaults to current page)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('reset_instance_spacing', params))
);

server.tool(
  'figma_reset_instance_text_styles',
  'Reset text style overrides on text nodes inside instances to match their master components.',
  {
    nodeId: z.string().optional().describe('ID of the root node to scan (defaults to current page)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('reset_instance_text_styles', params))
);

server.tool(
  'figma_unclip_text_parent_frames',
  'Turn off clip content on frames that have direct text children, so text is not cut off.',
  {
    nodeId: z.string().optional().describe('ID of the root node to scan (defaults to current page)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('unclip_text_parent_frames', params))
);

// ─── Image Operations ────────────────────────────────────────────────────────

server.tool(
  'figma_find_image_nodes',
  'Find all nodes with image fills in a subtree. Deduplicates by image hash.',
  {
    nodeId: z.string().optional().describe('ID of the root node to scan (defaults to current page)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('find_image_nodes', params))
);

server.tool(
  'figma_export_node',
  'Export a node as a base64-encoded image (PNG, JPG, SVG, or PDF).',
  {
    nodeId: z.string().describe('ID of the node to export'),
    format: z.enum(['PNG', 'JPG', 'SVG', 'PDF']).optional().default('PNG').describe('Export format'),
    scale: z.number().optional().default(2).describe('Scale factor for raster formats (1-4)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('export_node', params))
);

// ─── Screenshot Tools ──────────────────────────────────────────────────────

server.tool(
  'figma_screenshot_selection',
  'Screenshot everything currently selected in Figma. Handles multi-selection by exporting each node individually with deduplication. Paginated — call again with page=2 for more if hasMore is true.',
  {
    format: z.enum(['PNG', 'JPG']).optional().default('PNG').describe('Image format'),
    scale: z.number().optional().default(2).describe('Scale factor (1=1x, 2=2x retina, 4=4x)'),
    page: z.number().optional().default(1).describe('Page number for paginated results'),
    pageSize: z.number().optional().default(15).describe('Nodes per page (default 15)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => formatResult(await run('screenshot_selection', params))
);

server.tool(
  'figma_screenshot_node',
  'Screenshot a specific node by its ID. Works on any node type: frames, components, vectors, text, etc.',
  {
    nodeId: z.string().describe('ID of the node to screenshot'),
    format: z.enum(['PNG', 'JPG']).optional().default('PNG').describe('Image format'),
    scale: z.number().optional().default(2).describe('Scale factor (1=1x, 2=2x retina, 4=4x)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => formatResult(await run('screenshot_node', params))
);

server.tool(
  'figma_screenshot_by_link',
  'Take a Figma link and screenshot the node it points to. Parses the URL, finds the node, captures it — all in one call.',
  {
    url: z.string().describe('Full Figma URL with node-id parameter (e.g. https://www.figma.com/design/.../...?node-id=1-2)'),
    format: z.enum(['PNG', 'JPG']).optional().default('PNG').describe('Image format'),
    scale: z.number().optional().default(2).describe('Scale factor'),
  },
  async (params) => {
    const u = new URL(params.url);
    if (!u.hostname.includes('figma.com')) throw new Error('Not a Figma URL');
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex(p => p === 'design' || p === 'file' || p === 'proto');
    const fileKey = idx !== -1 ? parts[idx + 1] : null;
    let nodeId = u.searchParams.get('node-id');
    if (nodeId) {
      nodeId = decodeURIComponent(nodeId);
      if (!nodeId.includes(':')) nodeId = nodeId.replace('-', ':');
    }
    if (!nodeId) throw new Error('No node-id found in URL. Add ?node-id=... to the link.');
    return formatResult(await run('screenshot_node', { nodeId, format: params.format, scale: params.scale, fileKey }));
  }
);

server.tool(
  'figma_screenshot_page_overview',
  'Screenshot the entire current Figma page as a birds-eye view. Falls back to exporting top-level frames individually if full-page export fails.',
  {
    format: z.enum(['PNG', 'JPG']).optional().default('JPG').describe('JPG recommended for large pages'),
    scale: z.number().optional().default(1).describe('1x recommended for page overview'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => formatResult(await run('screenshot_page_overview', params))
);

// ─── AI Exploration Tools ──────────────────────────────────────────────────

server.tool(
  'figma_find_and_screenshot',
  'Search for nodes by name/type/text and screenshot all matches. The AI can visually inspect what it found. Paginated — call again with page=2 for more.',
  {
    query: z.string().describe('Search string — matches against node name and text content'),
    type: z.string().optional().describe('Filter by node type: FRAME, COMPONENT, TEXT, RECTANGLE, etc.'),
    rootNodeId: z.string().optional().describe('Search within this node only (defaults to current page)'),
    page: z.number().optional().default(1).describe('Page number for paginated results'),
    pageSize: z.number().optional().default(10).describe('Nodes per page'),
    scale: z.number().optional().default(1).describe('1x recommended for search results'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => formatResult(await run('find_and_screenshot', params))
);

server.tool(
  'figma_screenshot_frame_thumbnails',
  'Screenshot every top-level frame as thumbnails. Gives the AI a quick overview of everything on the page. Paginated — call again with page=2 for more.',
  {
    scale: z.number().optional().default(0.5).describe('Thumbnail scale (0.5 = half size)'),
    page: z.number().optional().default(1).describe('Page number for paginated results'),
    pageSize: z.number().optional().default(20).describe('Frames per page'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => formatResult(await run('screenshot_frame_thumbnails', params))
);

server.tool(
  'figma_screenshot_node_with_context',
  'Screenshot a node AND its parent frame for visual context. Shows the element in its layout surroundings.',
  {
    nodeId: z.string().describe('ID of the specific node to focus on'),
    format: z.enum(['PNG', 'JPG']).optional().default('PNG').describe('Image format'),
    scale: z.number().optional().default(2).describe('Scale factor'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => formatResult(await run('screenshot_node_with_context', params))
);

// ─── Viewport & Canvas Management ──────────────────────────────────────────

server.tool(
  'figma_get_viewport_info',
  'Get the current viewport center, zoom level, and visible bounds. Lets the AI know what area of the canvas the user is looking at.',
  { fileKey: z.string().optional().describe('Target a specific Figma file by its key') },
  async (params) => jsonContent(await run('get_viewport_info', params))
);

server.tool(
  'figma_find_visible_nodes',
  'List which top-level frames are currently visible in the Figma viewport (what the user sees on screen).',
  { fileKey: z.string().optional().describe('Target a specific Figma file by its key') },
  async (params) => jsonContent(await run('find_visible_nodes', params))
);

server.tool(
  'figma_screenshot_viewport_region',
  'Screenshot what the user currently sees on their Figma canvas. Captures all frames visible in the viewport.',
  {
    scale: z.number().optional().default(1).describe('Scale factor'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => formatResult(await run('screenshot_viewport_region', params))
);

server.tool(
  'figma_scroll_to_node',
  'Scroll the Figma canvas to center on a specific node. Creates shared visual context between AI and user.',
  {
    nodeId: z.string().describe('ID of the node to scroll to'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('scroll_to_node', params))
);

// ─── Advanced / Escape Hatch ─────────────────────────────────────────────────

server.tool(
  'figma_execute',
  'Execute arbitrary JavaScript in the Figma plugin context. Powerful escape hatch — has full access to the Figma Plugin API. Returns the result of the expression. Use for operations not covered by other tools.',
  {
    code: z.string().describe('JavaScript expression or async IIFE to execute in the Figma plugin context. Has access to figma global.'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => {
    const result = await run('figma_execute', params, { timeoutMs: 300000 });
    return jsonContent(result);
  }
);

// ─── Node Manipulation (new) ─────────────────────────────────────────────────

server.tool(
  'figma_clone_node',
  'Clone any node. Optionally place under a parent and offset its position.',
  {
    nodeId: z.string().describe('ID of the node to clone'),
    parentId: z.string().optional().describe('ID of the parent node to place the clone under'),
    offsetX: z.number().optional().describe('Horizontal offset from the original position'),
    offsetY: z.number().optional().describe('Vertical offset from the original position'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('clone_node', params))
);

server.tool(
  'figma_move_node',
  'Move a node to a new x/y position.',
  {
    nodeId: z.string().describe('ID of the node to move'),
    x: z.number().describe('New x position'),
    y: z.number().describe('New y position'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('move_node', params))
);

server.tool(
  'figma_resize_node',
  'Resize a node to new width and/or height.',
  {
    nodeId: z.string().describe('ID of the node to resize'),
    width: z.number().optional().describe('New width in pixels'),
    height: z.number().optional().describe('New height in pixels'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('resize_node', params))
);

// ─── Component Operations (new) ──────────────────────────────────────────────

server.tool(
  'figma_search_components',
  'Search for local components and component sets by name in the current file.',
  {
    query: z.string().describe('Search string to match against component names (case-insensitive)'),
    includeLibrary: z.boolean().optional().default(false).describe('Attempt library search (requires REST API for full results)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('search_components', params))
);

server.tool(
  'figma_get_component_details',
  'Get detailed information about a component or component set: properties, variants, variant groups.',
  {
    nodeId: z.string().describe('ID of the COMPONENT or COMPONENT_SET node'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('get_component_details', params))
);

server.tool(
  'figma_get_library_components',
  'Get information about accessing team library components (requires Figma REST API for full enumeration).',
  {
    query: z.string().optional().describe('Optional search query'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('get_library_components', params))
);

server.tool(
  'figma_instantiate_component',
  'Create an instance of a component and place it on the page or under a parent.',
  {
    componentId: z.string().describe('ID of the COMPONENT or COMPONENT_SET to instantiate'),
    parentId: z.string().optional().describe('ID of a parent node to place the instance under'),
    x: z.number().optional().describe('X position for the new instance'),
    y: z.number().optional().describe('Y position for the new instance'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('instantiate_component', params))
);

server.tool(
  'figma_add_component_property',
  'Add a component property (text, boolean, instance swap, etc.) to a component or component set.',
  {
    nodeId: z.string().describe('ID of the COMPONENT or COMPONENT_SET'),
    property: z.object({
      name: z.string().describe('Property name'),
      type: z.enum(['TEXT', 'BOOLEAN', 'INSTANCE_SWAP']).describe('Property type'),
      defaultValue: z.union([z.string(), z.boolean()]).describe('Default value for the property'),
      options: z.array(z.any()).optional().describe('For INSTANCE_SWAP: preferred component IDs'),
    }).describe('Property definition'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('add_component_property', params))
);

server.tool(
  'figma_edit_component_property',
  'Edit an existing component property (rename, change default value, etc.).',
  {
    nodeId: z.string().describe('ID of the COMPONENT or COMPONENT_SET'),
    propertyName: z.string().describe('Name of the property to edit'),
    updates: z.record(z.any()).describe('Object with properties to update (name, defaultValue, preferredValues)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('edit_component_property', params))
);

server.tool(
  'figma_delete_component_property',
  'Delete a component property from a component or component set.',
  {
    nodeId: z.string().describe('ID of the COMPONENT or COMPONENT_SET'),
    propertyName: z.string().describe('Name of the property to delete'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('delete_component_property', params))
);

server.tool(
  'figma_set_description',
  'Set the description text on any node (visible in the right panel in Figma).',
  {
    nodeId: z.string().describe('ID of the node'),
    description: z.string().describe('Description text to set'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('set_description', params))
);

server.tool(
  'figma_analyze_component_set',
  'Deep analysis of a component set: variant properties, per-variant overrides, and cross-variant diffs.',
  {
    nodeId: z.string().describe('ID of the COMPONENT_SET to analyze'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('analyze_component_set', params))
);

// ─── Variable CRUD (new) ─────────────────────────────────────────────────────

server.tool(
  'figma_create_variable_collection',
  'Create a new variable collection with optional additional modes.',
  {
    name: z.string().describe('Name for the new collection'),
    modes: z.array(z.string()).optional().describe('Additional mode names (default mode "Mode 1" is created automatically)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('create_variable_collection', params))
);

server.tool(
  'figma_create_variable',
  'Create a new variable in a collection with optional mode-specific values.',
  {
    collectionId: z.string().describe('ID of the variable collection'),
    name: z.string().describe('Variable name (e.g. "primary/500")'),
    resolvedType: z.enum(['COLOR', 'FLOAT', 'STRING', 'BOOLEAN']).optional().default('COLOR').describe('Variable type'),
    valuesByMode: z.record(z.any()).optional().describe('Mode ID → value mapping. For colors use {r,g,b,a} objects.'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('create_variable', params))
);

server.tool(
  'figma_update_variable',
  'Update a variable\'s value per mode and/or rename it.',
  {
    variableId: z.string().describe('ID of the variable'),
    valuesByMode: z.record(z.any()).optional().describe('Mode ID → new value mapping'),
    name: z.string().optional().describe('New name for the variable'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('update_variable', params))
);

server.tool(
  'figma_rename_variable',
  'Rename a variable.',
  {
    variableId: z.string().describe('ID of the variable'),
    name: z.string().describe('New name for the variable'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('rename_variable', params))
);

server.tool(
  'figma_delete_variable',
  'Delete a variable from the file.',
  {
    variableId: z.string().describe('ID of the variable to delete'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('delete_variable', params))
);

server.tool(
  'figma_delete_variable_collection',
  'Delete an entire variable collection and all its variables.',
  {
    collectionId: z.string().describe('ID of the collection to delete'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('delete_variable_collection', params))
);

server.tool(
  'figma_add_mode',
  'Add a new mode to an existing variable collection.',
  {
    collectionId: z.string().describe('ID of the variable collection'),
    modeName: z.string().describe('Name for the new mode (e.g. "Dark", "Mobile")'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('add_mode', params))
);

server.tool(
  'figma_rename_mode',
  'Rename a mode within a variable collection.',
  {
    collectionId: z.string().describe('ID of the variable collection'),
    oldName: z.string().describe('Current name of the mode'),
    newName: z.string().describe('New name for the mode'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('rename_mode', params))
);

// ─── Annotations & Image (new) ───────────────────────────────────────────────

server.tool(
  'figma_get_annotations',
  'Read annotations from a node, optionally traversing all children.',
  {
    nodeId: z.string().optional().describe('Node ID to read annotations from (defaults to current page)'),
    traverse: z.boolean().optional().default(false).describe('If true, collect annotations from all descendant nodes'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('get_annotations', params))
);

server.tool(
  'figma_set_annotations',
  'Set annotations on a node. Each annotation can have a label, message, properties, and status.',
  {
    nodeId: z.string().describe('Node ID to annotate'),
    annotations: z.array(z.object({
      label: z.string().optional().default('').describe('Short label for the annotation'),
      message: z.string().optional().default('').describe('Detailed annotation message'),
      properties: z.array(z.any()).optional().default([]).describe('Properties to pin'),
      status: z.string().optional().describe('Status string'),
    })).describe('Array of annotation objects'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('set_annotations', params))
);

server.tool(
  'figma_set_image_fill',
  'Set an image fill on a node using base64-encoded image data.',
  {
    nodeId: z.string().describe('ID of the node to set image fill on'),
    imageData: z.string().describe('Base64-encoded image data or raw bytes'),
    format: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional().default('FILL').describe('Image scale mode'),
    fillIndex: z.number().optional().default(0).describe('Which fill index to replace (0 = first fill)'),
    fileKey: z.string().optional().describe('Target a specific Figma file by its key'),
  },
  async (params) => jsonContent(await run('set_image_fill', params))
);

  return server;
}

// ─── HTTP Server & MCP Transport ─────────────────────────────────────────────

async function handleMcpRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Mcp-Session-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const sessionId = req.headers['mcp-session-id'];

  let transport;

  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
  } else if (req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
    });

    let parsed;
    try { parsed = body ? JSON.parse(body) : undefined; } catch { parsed = undefined; }

    const isInit = parsed && (
      (Array.isArray(parsed) ? parsed.some(m => m.method === 'initialize') : parsed.method === 'initialize')
    );

    const isFreshInit = !sessionId && isInit;

    if (isFreshInit) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport;
          console.log(`[figlink-mcp] Session initialized: ${id.slice(0, 8)}...`);
        },
        onsessionclosed: (id) => {
          delete transports[id];
          console.log(`[figlink-mcp] Session closed: ${id.slice(0, 8)}...`);
        },
      });

      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);

      await transport.handleRequest(req, res, parsed);
      return;
    }

    if (sessionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }));
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID' }, id: null }));
    return;
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      server: 'figlink-mcp',
      version: '1.0.0',
      status: 'ok',
      protocol: 'MCP Streamable HTTP',
      hint: 'Send POST / with {"jsonrpc":"2.0","method":"initialize","id":"1"} to start an MCP session',
    }));
    return;
  } else {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID' }, id: null }));
    return;
  }

  try {
    if (req.method === 'POST') {
      const body = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => resolve(data));
      });
      let parsed;
      try { parsed = body ? JSON.parse(body) : undefined; } catch { parsed = undefined; }
      await transport.handleRequest(req, res, parsed);
    } else if (req.method === 'GET' || req.method === 'DELETE') {
      await transport.handleRequest(req, res);
    } else {
      res.writeHead(405);
      res.end('Method Not Allowed');
    }
  } catch (err) {
    console.error('[figlink-mcp] HTTP handler error:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
    }
  }
}

async function main() {
  const httpServer = http.createServer(async (req, res) => {
    const urlPath = req.url.split('?')[0];

    if (urlPath.startsWith('/.well-known/') || urlPath.startsWith('/oauth/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OAuth is not configured on this MCP server' }));
      return;
    }

    await handleMcpRequest(req, res);
  });

  httpServer.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════╗');
    console.log('  ║                                                      ║');
    console.log('  ║   Figlink MCP Server — Ready                          ║');
    console.log('  ║                                                      ║');
    console.log(`  ║   HTTP:  http://localhost:${PORT}                          ║`);
    console.log(`  ║   Figlink: ${bridge.url}                               ║`);
    console.log('  ║                                                      ║');
    console.log('  ║   To expose to the web, run ngrok:                    ║');
    console.log(`  ║   ngrok http ${PORT}                                     ║`);
    console.log('  ║                                                      ║');
    console.log('  ╚══════════════════════════════════════════════════════╝');
    console.log('');
  });

  bridge.connect();

  process.on('SIGINT', () => {
    console.log('\n[figlink-mcp] Shutting down...');
    for (const id of Object.keys(transports)) {
      transports[id].close().catch(() => {});
      delete transports[id];
    }
    bridge.disconnect();
    httpServer.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    for (const id of Object.keys(transports)) {
      transports[id].close().catch(() => {});
      delete transports[id];
    }
    bridge.disconnect();
    httpServer.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[figlink-mcp] Fatal error:', err);
  process.exit(1);
});
