#!/usr/bin/env node
// Reset the "size" component property on all instances of a given component set,
// across all pages in the currently open Figma file.
//
// Usage:
//   node tools/reset-size-property.js <componentNodeId>
//   node tools/reset-size-property.js 156:3523

const WebSocket = require('../link-server/node_modules/ws');
const { randomUUID } = require('crypto');

// ─── Args ─────────────────────────────────────────────────────────────────────

const componentNodeId = process.argv[2];

if (!componentNodeId) {
  console.error('Usage: node tools/reset-size-property.js <componentNodeId>');
  console.error('Example: node tools/reset-size-property.js 156:3523');
  process.exit(1);
}

// ─── WebSocket helper ─────────────────────────────────────────────────────────

function send(command, params, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:9001');
    const id = randomUUID();
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; ws.close(); reject(new Error(`Timeout on command "${command}"`)); }
    }, timeoutMs);

    ws.on('open', () => ws.send(JSON.stringify({ id, command, params })));

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'active_prompt') return;
      if (msg.id !== id) return;
      done = true; clearTimeout(timer); ws.close();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result);
    });

    ws.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  // 1. Ping
  await send('ping').catch(() => {
    console.error('Figlink not reachable — is the server running and plugin open?');
    process.exit(1);
  });

  console.log(`\nSearching for instances of component ${componentNodeId} across all pages…`);

  // 2. Run the operation inside the plugin context
  const code = `
(async () => {
  await figma.loadAllPagesAsync();

  const componentNode = figma.getNodeById(${JSON.stringify(componentNodeId)});
  if (!componentNode) return { error: 'Component node not found', id: ${JSON.stringify(componentNodeId)} };

  const nodeType = componentNode.type;
  if (nodeType !== 'COMPONENT' && nodeType !== 'COMPONENT_SET') {
    return { error: 'Node is not a COMPONENT or COMPONENT_SET', type: nodeType };
  }

  // Collect all variant component IDs (or just the single component)
  const componentIds = new Set();
  if (nodeType === 'COMPONENT_SET') {
    for (const child of componentNode.children) {
      if (child.type === 'COMPONENT') componentIds.add(child.id);
    }
  } else {
    componentIds.add(componentNode.id);
  }

  // Resolve property definitions — for a set, they live on the set itself;
  // for a plain component, they live on the component.
  const defs = componentNode.componentPropertyDefinitions || {};
  const sizeKey = Object.keys(defs).find(k => k.toLowerCase().startsWith('size'));

  if (!sizeKey) {
    return {
      error: 'No "size" property found on this component',
      availableProperties: Object.keys(defs),
    };
  }

  const defaultValue = defs[sizeKey].defaultValue;

  // Walk every page and collect instances
  let instancesFound = 0;
  let instancesModified = 0;
  let instancesAlreadyDefault = 0;
  const modified = [];

  for (const page of figma.root.children) {
    const instances = page.findAll(n => {
      if (n.type !== 'INSTANCE') return false;
      const mc = n.mainComponent;
      return mc && componentIds.has(mc.id);
    });

    instancesFound += instances.length;

    for (const inst of instances) {
      const currentProps = inst.componentProperties;

      if (!(sizeKey in currentProps)) continue;

      const currentValue = currentProps[sizeKey].value;

      if (currentValue === defaultValue) {
        instancesAlreadyDefault++;
        continue;
      }

      inst.setProperties({ [sizeKey]: defaultValue });
      instancesModified++;
      modified.push({
        page: page.name,
        instanceId: inst.id,
        instanceName: inst.name,
        from: currentValue,
        to: defaultValue,
      });
    }
  }

  return {
    ok: true,
    componentName: componentNode.name,
    componentType: nodeType,
    variantCount: componentIds.size,
    sizeKey,
    defaultValue,
    instancesFound,
    instancesModified,
    instancesAlreadyDefault,
    modified,
  };
})()
  `.trim();

  const result = await send('figma_execute', { code }, 60000);

  if (result.error) {
    console.error('\nError:', result.error);
    if (result.availableProperties) {
      console.error('Available properties:', result.availableProperties.join(', '));
    }
    process.exit(1);
  }

  console.log(`\nComponent:    "${result.componentName}" (${result.componentType})`);
  console.log(`Variants:     ${result.variantCount}`);
  console.log(`Size key:     ${result.sizeKey}`);
  console.log(`Default:      ${result.defaultValue}`);
  console.log(`\nInstances found:           ${result.instancesFound}`);
  console.log(`Already at default:        ${result.instancesAlreadyDefault}`);
  console.log(`Reset (modified):          ${result.instancesModified}`);

  if (result.modified && result.modified.length > 0) {
    console.log('\nModified instances:');
    for (const m of result.modified) {
      console.log(`  [${m.page}] "${m.instanceName}" (${m.instanceId})  ${m.from} → ${m.to}`);
    }
  }

  console.log('\nDone.');
})();
