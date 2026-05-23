#!/usr/bin/env node
// tools/bulk-operations.js
// Consolidated generic Figma operations
// Replaces 50+ one-off custom scripts with foundational, reusable actions.

const WebSocket = require('../link-server/node_modules/ws');
const { randomUUID } = require('crypto');

// ─── WebSocket helper ─────────────────────────────────────────────────────────

function send(command, params, timeoutMs = 2400000) { // Default to 40 minutes globally
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:9001');
    const id = randomUUID();
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; ws.close(); reject(new Error(`Timeout on command "${command}"`)); }
    }, timeoutMs);

    ws.on('open', () => {
      const msg = { id, command, params };
      if (typeof targetFileKey !== 'undefined' && targetFileKey) msg.fileKey = targetFileKey;
      ws.send(JSON.stringify(msg));
    });

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

// ─── Core Runner ──────────────────────────────────────────────────────────────

async function runFigmaCode(code, timeoutMs = 2400000) {
  return await send('figma_execute', { code }, timeoutMs);
}

// ─── Sentence-case page code builder ─────────────────────────────────────────
// Generates a self-contained Figma script that lints a single page by ID.
// Uses String.raw so regex patterns and \n inside the generated code are literal.

function makeSCPageCode(pageId) {
  return String.raw`
(async () => {
  const ACRONYMS = new Set([
    'HRIS','HR','HQ','API','IT','UI','UX','ID','CRM','ERP','SSO','OKR','KPI',
    'NDA','PTO','CTR','SLA','KYC','AML','PDF','CSV','PIN','OTP','SMS','FAQ',
    'TOS','VAT','TAX','URL','iOS','macOS','AM','PM','T&A','TA',
  ]);
  const BRAND_FIXES = [
    [/PaidHR/gi,   'PaidHR'],
    [/PaidLife/gi, 'PaidLife'],
  ];
  function applyBrandFixes(text) {
    let t = text;
    for (const [re, fix] of BRAND_FIXES) t = t.replace(re, fix);
    return t;
  }
  function isAcronym(w) {
    const c = w.replace(/[^a-zA-Z]/g, '');
    if (ACRONYMS.has(c)) return true;
    if (ACRONYMS.has(c.toUpperCase())) return true;  // case-insensitive (am → AM)
    if (/^[A-Z]{2}/.test(w)) return true;            // two leading caps = likely acronym
    return false;
  }
  function toSC(text) {
    return text.split('\n').map(line => {
      if (!line) return line;
      const tokens = [];
      let cur = '';
      for (const ch of line) {
        if (/[a-zA-Z''']/.test(ch)) { cur += ch; }
        else { if (cur) { tokens.push({t:'w',v:cur}); cur=''; } tokens.push({t:'s',v:ch}); }
      }
      if (cur) tokens.push({t:'w',v:cur});
      let capNext = true, afterDot = false, digitBeforeWord = false;
      return tokens.map(tok => {
        if (tok.t === 's') {
          if (capNext && /\d/.test(tok.v)) digitBeforeWord = true;
          if (/[.!?]/.test(tok.v)) { afterDot = true; }
          else if (afterDot && /\s/.test(tok.v)) { capNext = true; afterDot = false; digitBeforeWord = false; }
          else if (!/\s/.test(tok.v)) { afterDot = false; }
          return tok.v;
        }
        const w = tok.v;
        if (w === 'I' || /^I[''']/.test(w)) { capNext = false; afterDot = false; digitBeforeWord = false; return w; }
        if (isAcronym(w)) { capNext = false; afterDot = false; digitBeforeWord = false; return w; }
        if (capNext) {
          const result = digitBeforeWord ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase();
          capNext = false; afterDot = false; digitBeforeWord = false;
          return result;
        }
        digitBeforeWord = false;
        return w.toLowerCase();
      }).join('');
    }).join('\n');
  }
  const isAddress = t => /^\d+\s+[A-Z]/.test(t);

  const page = figma.root.children.find(p => p.id === '` + pageId + String.raw`');
  if (!page) return { totalApplied: 0, totalFailed: 0, fontLoadErrors: [], samples: [] };

  const changes = [], fontSet = new Set();
  for (const n of page.findAll(nd => nd.type === 'TEXT')) {
    const orig = n.characters;
    if (!orig || !/[a-zA-Z]/.test(orig) || isAddress(orig)) continue;
    const proposed = applyBrandFixes(toSC(orig));
    if (proposed === orig) continue;
    changes.push({ n, orig, proposed });
    if (n.fontName !== figma.mixed) {
      fontSet.add(JSON.stringify(n.fontName));
    } else {
      try {
        for (let i = 0; i < orig.length; i++) {
          const fn = n.getRangeFontName(i, i + 1);
          if (fn !== figma.mixed) fontSet.add(JSON.stringify(fn));
        }
      } catch(_) {}
    }
  }

  const loadErrors = [];
  for (const fj of fontSet) {
    try { await figma.loadFontAsync(JSON.parse(fj)); }
    catch(e) { loadErrors.push(fj + ': ' + e.message); }
  }

  let applied = 0, failed = 0;
  const samples = [];
  for (const { n, orig, proposed } of changes) {
    try {
      n.characters = proposed;
      applied++;
      if (samples.length < 8)
        samples.push('"' + orig.substring(0,50) + '" → "' + proposed.substring(0,50) + '"');
    } catch(e) {
      failed++;
      samples.push('FAIL "' + orig.substring(0,50) + '": ' + e.message);
    }
  }
  return { totalApplied: applied, totalFailed: failed, fontLoadErrors: loadErrors, samples };
})()
`;
}

// ─── Foundational Operations ──────────────────────────────────────────────────

const operations = {
  
  /**
   * Bulk bind a specific property on matching nodes to a variable.
   * Useful for: Binding radius/strokes to variables globally.
   * Usage: node bulk-operations.js bind_variable <property> <variableId> [nodeTypeFilter]
   */
  bind_variable: async (property, variableId, nodeTypeFilter = 'ALL') => {
    console.log(`Binding property '${property}' to variable '${variableId}' (Filter: ${nodeTypeFilter})...`);
    const code = `
      (async () => {
        await figma.loadAllPagesAsync();
        let count = 0;
        const filter = ${JSON.stringify(nodeTypeFilter)};
        const prop = ${JSON.stringify(property)};
        const varId = ${JSON.stringify(variableId)};
        
        for (const page of figma.root.children) {
          const nodes = page.findAll(n => (filter === 'ALL' || n.type === filter) && prop in n);
          for (const n of nodes) {
            try {
              n.setBoundVariable(prop, varId);
              count++;
            } catch (e) {}
          }
        }
        return { modified: count };
      })()
    `;
    const res = await runFigmaCode(code);
    console.log('Result:', res);
  },

  /**
   * Bulk find and replace text across all pages based on a JSON map.
   * Useful for: Updating copy, fixing lorem ipsum.
   * Usage: node bulk-operations.js replace_text <json_map_path>
   */
  replace_text: async (jsonMapPath) => {
    const fs = require('fs');
    if (!fs.existsSync(jsonMapPath)) throw new Error('File not found: ' + jsonMapPath);
    const map = JSON.parse(fs.readFileSync(jsonMapPath, 'utf8'));
    console.log(`Replacing text for ${Object.keys(map).length} nodes...`);
    
    const code = `
      (async () => {
        await figma.loadAllPagesAsync();
        const map = ${JSON.stringify(map)};
        let count = 0;
        let notFound = [];
        
        for (const [id, newText] of Object.entries(map)) {
          const n = figma.getNodeById(id);
          if (n && n.type === 'TEXT') {
            await Promise.all(n.getRangeAllFontNames(0, n.characters.length).map(figma.loadFontAsync));
            n.characters = newText;
            count++;
          } else {
            notFound.push(id);
          }
        }
        return { modified: count, notFound: notFound.length };
      })()
    `;
    const res = await runFigmaCode(code, 300000);
    console.log('Result:', res);
  },

  /**
   * Bulk reset instances across all pages.
   * Useful for: Reverting rogue text style overrides or stray sizing.
   * Usage: node bulk-operations.js reset_instances [preserveText:true|false]
   */
  reset_instances: async (preserveTextStr = 'true') => {
    const preserveText = preserveTextStr === 'true';
    console.log(`Resetting instances (Preserve Text: ${preserveText})...`);
    
    const code = `
      (async () => {
        await figma.loadAllPagesAsync();
        let count = 0;
        const preserve = ${preserveText};
        
        for (const page of figma.root.children) {
          const instances = page.findAll(n => n.type === 'INSTANCE');
          for (const inst of instances) {
            let texts = [];
            if (preserve) {
              const textNodes = inst.findAll(n => n.type === 'TEXT');
              texts = textNodes.map(t => ({ id: t.id, chars: t.characters }));
            }
            try {
              inst.resetOverrides();
              count++;
              if (preserve) {
                // Restore text
                for (const t of texts) {
                  const node = figma.getNodeById(t.id);
                  if (node && node.type === 'TEXT') {
                    await Promise.all(node.getRangeAllFontNames(0, node.characters.length).map(figma.loadFontAsync));
                    node.characters = t.chars;
                  }
                }
              }
            } catch(e) {}
          }
        }
        return { reset: count };
      })()
    `;
    const res = await runFigmaCode(code, 600000);
    console.log('Result:', res);
  },

  /**
   * Scan texts across all pages matching a regex.
   * Useful for: Finding bad texts, lorem ipsum, long texts.
   * Usage: node bulk-operations.js scan_text <regex>
   */
  scan_text: async (regexStr) => {
    console.log(`Scanning texts matching /${regexStr}/i...`);
    const code = `
      (async () => {
        await figma.loadAllPagesAsync();
        const regex = new RegExp(${JSON.stringify(regexStr)}, 'i');
        const matches = [];
        
        for (const page of figma.root.children) {
          const texts = page.findAll(n => n.type === 'TEXT' && regex.test(n.characters));
          for (const t of texts) {
            matches.push({ id: t.id, text: t.characters, page: page.name });
          }
        }
        return { count: matches.length, matches: matches.slice(0, 100) }; // limit output
      })()
    `;
    const res = await runFigmaCode(code, 300000);
    console.log(`Found ${res.count} matches. Showing up to 100:`);
    console.log(res.matches);
  },

  /**
   * Bulk modify a specific boolean/number property (e.g. clipContent = false)
   * Useful for: Setting clipContent globally or tweaking simple layout fields.
   * Usage: node bulk-operations.js set_property <property> <value> [nodeTypeFilter]
   */
  set_property: async (property, valueStr, nodeTypeFilter = 'ALL') => {
    console.log(`Setting property '${property}' to '${valueStr}' (Filter: ${nodeTypeFilter})...`);
    let value = valueStr;
    if (valueStr === 'true') value = true;
    if (valueStr === 'false') value = false;
    if (!isNaN(Number(valueStr))) value = Number(valueStr);
    
    const code = `
      (async () => {
        await figma.loadAllPagesAsync();
        let count = 0;
        const filter = ${JSON.stringify(nodeTypeFilter)};
        const prop = ${JSON.stringify(property)};
        const val = ${JSON.stringify(value)};
        
        for (const page of figma.root.children) {
          const nodes = page.findAll(n => (filter === 'ALL' || n.type === filter) && prop in n);
          for (const n of nodes) {
            try {
              n[prop] = val;
              count++;
            } catch (e) {}
          }
        }
        return { modified: count };
      })()
    `;
    const res = await runFigmaCode(code, 300000);
    console.log('Result:', res);
  },

  /**
   * Bulk exclude components from publishing by prefixing them with a dot.
   * Useful for: Hiding icon sets or private components.
   * Usage: node bulk-operations.js exclude_components <nodeId>
   */
  exclude_components: async (nodeId) => {
    console.log(`Excluding components inside node '${nodeId}'...`);
    const code = `
      (async () => {
        const targetNode = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
        if (!targetNode) throw new Error("Node not found.");
        
        let count = 0;
        
        const processNode = (n) => {
          if (!n.name.startsWith(".") && !n.name.startsWith("_")) {
            n.name = "." + n.name;
            count++;
          }
        };

        if (targetNode.type === "COMPONENT" || targetNode.type === "COMPONENT_SET") {
          processNode(targetNode);
        }
        
        if (targetNode.findAll) {
          const components = targetNode.findAll(n => n.type === "COMPONENT" || n.type === "COMPONENT_SET");
          for (const comp of components) {
            processNode(comp);
          }
        }
        
        return { excluded: count };
      })()
    `;
    const res = await runFigmaCode(code, 300000);
    console.log('Result:', res);
  },

  /**
   * Bind font sizes in text styles to corresponding FLOAT variables.
   * Useful for: Connecting hardcoded text styles to typography variables.
   * Usage: node bulk-operations.js bind_text_style_font_sizes
   */
  bind_text_style_font_sizes: async () => {
    console.log('Binding text style font sizes to variables...');
    const code = `
      (async () => {
        const textStyles = await figma.getLocalTextStylesAsync();
        const variables = await figma.variables.getLocalVariablesAsync('FLOAT');
        
        let count = 0;
        const missing = new Set();
        const sizeToVar = {};
        const errors = [];

        // Map FLOAT variables by their value
        for (const v of variables) {
          const modes = Object.keys(v.valuesByMode);
          if (modes.length === 0) continue;
          
          const val = v.valuesByMode[modes[0]];
          if (typeof val === 'number') {
            if (!sizeToVar[val]) {
              sizeToVar[val] = v;
            } else {
              // Prefer variables with "size" or "font" in their name if there's a conflict
              const existing = sizeToVar[val];
              const vName = v.name.toLowerCase();
              const existingName = existing.name.toLowerCase();
              const isVSize = vName.includes('size') || vName.includes('font');
              const isExistingSize = existingName.includes('size') || existingName.includes('font');
              
              if (isVSize && !isExistingSize) {
                sizeToVar[val] = v;
              }
            }
          }
        }

        for (const style of textStyles) {
          const size = style.fontSize;
          const v = sizeToVar[size];
          if (v) {
            try {
              style.setBoundVariable('fontSize', figma.variables.createVariableAlias(v));
              count++;
            } catch(e) {
              errors.push(e.message + " - size: " + size + " style: " + style.name);
            }
          } else {
            missing.add(size);
          }
        }
        
        return { 
          totalTextStyles: textStyles.length,
          totalFloatVars: variables.length,
          boundStylesCount: count,
          unboundSizes: Array.from(missing),
          errors: errors.slice(0, 5)
        };
      })()
    `;
    const res = await runFigmaCode(code, 300000);
    console.log('Result:', res);
  },

  /**
   * Update strokes across all pages.
   * Usage: node bulk-operations.js update_all_strokes <fileKey>
   */
  update_all_strokes: async (fileKeyArg) => {
    const fileKey = fileKeyArg || targetFileKey;
    if (!fileKey) { console.error('Missing fileKey (use --file <fileKey> or pass as arg)'); return; }
    
  
  
  
  const variableKey = 'd1d6299a98d89fe0be1dcd5f4b0bdd242a7177a3'; // border-width/1-4 from mina ds

  console.log(`\n--- Starting processing for file: ${fileKey} ---`);

  // Get pages to process
  const getPagesCode = `
    (async () => {
      await figma.loadAllPagesAsync();
      const pages = [];
      for (const p of figma.root.children) {
        if (!p.name.toLowerCase().includes('ignore')) {
          pages.push({ id: p.id, name: p.name });
        }
      }
      return pages;
    })()
  `;

  let pages;
  try {
    pages = await send('figma_execute', { code: getPagesCode }, 60000);
  } catch (err) {
    console.error("Failed to fetch pages: " + err.message);
    return;
  }

  if (pages.error || !Array.isArray(pages)) {
    console.error("Error from Figma fetching pages:", pages.error || pages);
    return;
  }

  console.log(`Found ${pages.length} valid pages to process.`);

  let totalModifiedInFile = 0;

  const pagesToRetry = [
    "recipient",
    "earned wage access",
    "send money",
    "transaction history",
    "loans",
    "notification",
    "settings",
    "branch selection - dev"
  ];

  for (const page of pages) {
    const normalizedName = page.name.trim();
    if (!pagesToRetry.includes(normalizedName)) {
      console.log(`Skipping page (not in retry list): ${page.name}`);
      continue;
    }

    console.log(`\nProcessing page: ${page.name}`);

    // Get nodes on the page
    const getNodesCode = `
      (async () => {
        // Import the variable
        let variable;
        try {
          variable = await figma.variables.importVariableByKeyAsync('${variableKey}');
          if (!variable) return { error: "Could not import variable" };
        } catch (e) {
          return { error: "Failed to import variable: " + e.message };
        }

        const pageId = ${JSON.stringify(page.id)};
        const pageNode = figma.getNodeById(pageId);
        if (!pageNode) return { error: "Page not found" };

        const targetNodes = [];

        // Iterative node collection to prevent stack overflow and heavy blocking
        async function collectNodes(rootNode) {
          const STROKE_TYPES = new Set(['FRAME', 'GROUP', 'SECTION', 'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'LINE']);
          const stack = [rootNode];
          let count = 0;

          while (stack.length > 0) {
            const n = stack.pop();
            if (!n) continue;

            count++;
            // Yield to the event loop occasionally so the Figma API doesn't freeze.
            // 2000 nodes is a good balance between speed and preventing UI lock.
            if (count % 500 === 0) await new Promise(r => setTimeout(r, 40));

            // Stop traversing down this branch if it's an instance or master component
            if (n.type === 'INSTANCE' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') {
              continue; 
            }

            if (STROKE_TYPES.has(n.type) && ('strokeWeight' in n)) {
              if (n.strokeWeight === 1 || n.strokeWeight === figma.mixed) {
                targetNodes.push(n.id);
              }
            }

            if ('children' in n && n.children) {
              for (let i = n.children.length - 1; i >= 0; i--) {
                stack.push(n.children[i]);
              }
            }
          }
        }

        await collectNodes(pageNode);

        return { nodes: targetNodes, variableId: variable.id };
      })()
    `;

    let setupRes;
    try {
      setupRes = await send('figma_execute', { code: getNodesCode }, 300000); // Increase timeout for huge pages
    } catch (err) {
      console.error(`  Failed to fetch nodes for page ${page.name}: ${err.message}`);
      continue;
    }

    if (setupRes.error) {
      console.error(`  Error from Figma on page ${page.name}:`, setupRes.error);
      continue;
    }

    const nodeIds = setupRes.nodes;
    const variableId = setupRes.variableId;

    console.log(`  Found ${nodeIds.length} candidate nodes. Starting batch processing...`);

    let totalModifiedOnPage = 0;
    const BATCH_SIZE = 20;

    for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
      const chunk = nodeIds.slice(i, i + BATCH_SIZE);
      console.log(`    Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(nodeIds.length / BATCH_SIZE)} (${chunk.length} nodes)...`);
      
      const batchCode = `
        (async () => {
          const varId = ${JSON.stringify(variableId)};
          const chunkIds = ${JSON.stringify(chunk)};
          
          let variable;
          try {
            variable = await figma.variables.getVariableByIdAsync(varId);
            if (!variable) return { error: "Variable not found" };
          } catch (e) {
            return { error: "Failed to get variable: " + e.message };
          }
          
          let count = 0;

          function processNode(n) {
            if (!n) return;

            let changed = false;
            
            if ('strokeWeight' in n) {
              const currentBindings = n.boundVariables || {};
              const vAlias = figma.variables.createVariableAlias(variable);

              if (n.strokeWeight !== figma.mixed && n.strokeWeight === 1) {
                // Uniform stroke weight of 1 on all sides
                if (!currentBindings['strokeWeight'] || currentBindings['strokeWeight'].id !== variable.id) {
                  try {
                    n.setBoundVariable('strokeWeight', vAlias);
                    changed = true;
                  } catch(e) {}
                }
              } else if (n.strokeWeight === figma.mixed) {
                // Per-side strokes, check individually
                const sides = ['strokeTopWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeRightWeight'];
                for (const side of sides) {
                  if (side in n && n[side] === 1) {
                    if (!currentBindings[side] || currentBindings[side].id !== variable.id) {
                      try {
                        n.setBoundVariable(side, vAlias);
                        changed = true;
                      } catch(e) {}
                    }
                  }
                }
              }
            }

            if (changed) count++;
          }

          for (const id of chunkIds) {
            const node = figma.getNodeById(id);
            if (node) {
              processNode(node);
            }
          }
          
          return { modified: count };
        })()
      `;

      try {
        const res = await send('figma_execute', { code: batchCode }, 120000);
        if (res && res.error) {
          console.error(`      Error: ${res.error}`);
        } else if (res) {
          console.log(`      Modified ${res.modified} nodes in this batch.`);
          totalModifiedOnPage += res.modified;
        }
      } catch (err) {
        console.error(`      Failed to process batch: ${err.message}`);
      }

      // Pause between batches
      await new Promise(r => setTimeout(r, 2000));
    }
    
    console.log(`  Finished page. Modified ${totalModifiedOnPage} nodes.`);
    totalModifiedInFile += totalModifiedOnPage;

    // Pause between pages
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log(`\nFinished file ${fileKey}! Total modified nodes: ${totalModifiedInFile}`);
  },

  /**
   * Update strokes in a specific frame.
   * Usage: node bulk-operations.js update_frame_strokes <fileKey> <targetFrameId>
   */
  update_frame_strokes: async (targetFrameId, fileKeyArg) => {
    const fileKey = fileKeyArg || targetFileKey;
    if (!fileKey || !targetFrameId) { console.error('Missing args (Usage: update_frame_strokes <targetFrameId> [--file <fileKey>])'); return; }
    
  
  const variableKey = 'd1d6299a98d89fe0be1dcd5f4b0bdd242a7177a3'; // border-width/1-4 from mina ds

  console.log('Fetching master components in frame...');
  
  const getComponentsCode = `
    (async () => {
      // Import the variable first
      let variable;
      try {
        variable = await figma.variables.importVariableByKeyAsync('${variableKey}');
        if (!variable) return { error: "Could not import variable" };
      } catch (e) {
        return { error: "Failed to import variable: " + e.message };
      }

      const frame = await figma.getNodeByIdAsync('${targetFrameId}');
      if (!frame) return { error: "Target frame not found" };

      const components = [];
      const masterComponents = frame.findAll(n => n.type === 'COMPONENT' || n.type === 'COMPONENT_SET');
      
      for (const comp of masterComponents) {
        // Check if this component is somehow inside an instance
        let isInsideInstance = false;
        let parent = comp.parent;
        while (parent && parent.type !== 'PAGE') {
          if (parent.type === 'INSTANCE') {
            isInsideInstance = true;
            break;
          }
          parent = parent.parent;
        }
        if (!isInsideInstance) {
          components.push(comp.id);
        }
      }
      
      return { components, variableId: variable.id };
    })()
  `;

  let setupRes;
  try {
    setupRes = await send('figma_execute', { code: getComponentsCode }, 120000);
  } catch (err) {
    console.error("Failed to fetch components: " + err.message);
    return;
  }

  if (setupRes.error) {
    console.error("Error from Figma:", setupRes.error);
    return;
  }

  const componentIds = setupRes.components;
  const variableId = setupRes.variableId;

  console.log(`Found ${componentIds.length} master components. Starting batch processing...`);

  let totalModified = 0;
  const BATCH_SIZE = 10;

  for (let i = 0; i < componentIds.length; i += BATCH_SIZE) {
    const chunk = componentIds.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(componentIds.length / BATCH_SIZE)} (${chunk.length} components)...`);
    
    const batchCode = `
      (async () => {
        const varId = ${JSON.stringify(variableId)};
        const chunkIds = ${JSON.stringify(chunk)};
        
        let variable;
        try {
          variable = await figma.variables.getVariableByIdAsync(varId);
          if (!variable) return { error: "Variable not found" };
        } catch (e) {
          return { error: "Failed to get variable: " + e.message };
        }
        
        let count = 0;
        const processedNodes = new Set();
        let visitedCount = 0;

        function processNode(n) {
          if (!n || processedNodes.has(n.id)) return;
          processedNodes.add(n.id);

          visitedCount++;

          // If it's an instance, do not process it or its children
          if (n.type === 'INSTANCE') return;
          
          // Only process nodes that can actually have a stroke weight
          const STROKE_TYPES = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'SECTION', 'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'LINE'];
          if (STROKE_TYPES.includes(n.type)) {
            let changed = false;
            
            if ('strokeWeight' in n) {
              const currentBindings = n.boundVariables || {};
              const vAlias = figma.variables.createVariableAlias(variable);

              if (n.strokeWeight !== figma.mixed && n.strokeWeight === 1) {
                // Uniform stroke weight of 1 on all sides
                if (!currentBindings['strokeWeight'] || currentBindings['strokeWeight'].id !== variable.id) {
                  try {
                    n.setBoundVariable('strokeWeight', vAlias);
                    changed = true;
                  } catch(e) {}
                }
              } else if (n.strokeWeight === figma.mixed) {
                // Per-side strokes, check individually
                const sides = ['strokeTopWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeRightWeight'];
                for (const side of sides) {
                  if (side in n && n[side] === 1) {
                    if (!currentBindings[side] || currentBindings[side].id !== variable.id) {
                      try {
                        n.setBoundVariable(side, vAlias);
                        changed = true;
                      } catch(e) {}
                    }
                  }
                }
              }
            }

            if (changed) count++;
          }
          
          // Skip text nodes since they don't have children in the same way and are deep
          if (n.type === 'TEXT') return;

          if ('children' in n) {
            for (const child of n.children) {
              processNode(child);
            }
          }
        }

        for (const id of chunkIds) {
          const comp = figma.getNodeById(id);
          if (comp) {
            processNode(comp);
          }
        }
        
        return { modified: count };
      })()
    `;

    try {
      const res = await send('figma_execute', { code: batchCode }, 120000);
      if (res && res.error) {
        console.error(`  Error: ${res.error}`);
      } else if (res) {
        console.log(`  Modified ${res.modified} nodes in this batch.`);
        totalModified += res.modified;
      }
    } catch (err) {
      console.error(`  Failed to process batch: ${err.message}`);
    }

    // Pause between batches to let the server and Figma breathe
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\nFinished! Total modified nodes: ${totalModified}`);
  },

  /**
   * Relink instances across pages.
   * Usage: node bulk-operations.js relink_instances
   */
  relink_instances: async () => {
    // Ported from temp/relink_pages.js
    console.log('Relink instances running...');
    for (const page of pages) {
    if (page.name.toLowerCase().includes('ignore') || page.name === '---') {
      console.log(`Skipping page: ${page.name}`);
      continue;
    }
    
    console.log(`\nProcessing page: ${page.name} (${page.id})`);
    
    // You can manually restrict which pages to run here if needed.
    // We are now running on all valid pages.
    
    // Step 1: Identify all instances that need swapping
    const identifyCode = `
    (async () => {
      const page = figma.getNodeById("${page.id}");
      if (!page) return { error: "Page not found" };
      
      let allFrames = [];
      let instancesFound = [];
      
      // Use an async queue to collect instances across the page to prevent freezing
      const queue = [page];
      
      let count = 0;
      while(queue.length > 0) {
          count++;
          if (count % 200 === 0) await new Promise(r => setTimeout(r, 10));
          
          const node = queue.shift();
          if (node.type === 'INSTANCE') {
              instancesFound.push(node.id);
          }
          if (node.children) {
              for (const child of node.children) {
                  queue.push(child);
              }
          }
      }
      
      return { instancesFound: instancesFound.length, needsSwap: [], frames: instancesFound };
    })()
    `;
    
    try {
      const identifyRes = await runFigmaCode('figma_execute', { code: identifyCode });
      
      if (!identifyRes || identifyRes.error) {
        console.error(`  Error identifying frames: ${identifyRes?.error || 'Unknown error'}`);
        continue;
      }
      
      const frames = identifyRes.frames || [];
      console.log(`  Found ${frames.length} top-level containers. Extracting instances frame by frame...`);
      
      let allNeedsSwap = [];
      let totalFound = 0;
      let allInstanceIds = [];
      
      // Since evaluating on Figma side is hanging, just process directly if it's an instance,
      // or we just process the top-level frames if they are not instances
      for (let f = 0; f < frames.length; f++) {
          const frameId = frames[f];
          allInstanceIds.push(frameId);
      }
      
      // Let's use `findAllWithCriteria({ types: ['INSTANCE'] })` but per top-level frame instead of the whole page, which might not OOM.
      console.log(`  Fetching properties for ${allInstanceIds.length} instances to evaluate locally...`);
      
      if (allInstanceIds.length === 0) continue;
      
      const BATCH_SIZE = 100;
      for (let i = 0; i < allInstanceIds.length; i += BATCH_SIZE) {
          const batch = allInstanceIds.slice(i, i + BATCH_SIZE);
          console.log(`    evaluating batch ${Math.floor(i/BATCH_SIZE)+1} of ${Math.ceil(allInstanceIds.length/BATCH_SIZE)}...`);
          
          const evalCode = `
          (async () => {
              const batch = ${JSON.stringify(batch)};
              const results = [];
              
              for (let i = 0; i < batch.length; i++) {
                   const instId = batch[i];
                   if (i % 20 === 0) await new Promise(r => setTimeout(r, 10));
                   
                   try {
                       const inst = figma.getNodeById(instId);
                       if (!inst || inst.type !== 'INSTANCE') continue;
                       
                       let master = null;
                       try { master = inst.mainComponent; } catch (e) {}
                       if (!master) continue;
                       
                       let masterParent = null;
                       try { masterParent = master.parent; } catch (e) {}
                       let masterName = null;
                       try { masterName = master.name; } catch (e) {}
                       
                       let setName = null;
                       let isSet = false;
                       
                       if (masterParent && masterParent.type === 'COMPONENT_SET') {
                           try { setName = masterParent.name; } catch (e) {}
                           isSet = true;
                       }
                       
                       if (masterName || setName) {
                           results.push({
                               id: inst.id,
                               setName,
                               masterName,
                               isSet
                           });
                       }
                   } catch (err) {}
              }
              return { results };
          })()
          `;
          
          try {
              const evalRes = await runFigmaCode('figma_execute', { code: evalCode });
              if (evalRes && evalRes.results) {
                  for (const r of evalRes.results) {
                      let targetKey = null;
                      let isVariant = false;
                      
                      if (r.isSet) {
                          if (r.setName && dsSets[r.setName]) {
                              targetKey = dsSets[r.setName];
                              isVariant = true;
                          }
                      } else {
                          const name = r.masterName;
                          if (name && dsSingles[name]) {
                              targetKey = dsSingles[name];
                          }
                      }
                      
                      if (targetKey) {
                          allNeedsSwap.push({
                              id: r.id,
                              targetKey,
                              isVariant,
                              oldProps: r.masterName
                          });
                      }
                  }
              }
          } catch(e) {
              console.log(`  Failed eval batch: ${e.message}`);
          }
      }
      
      const needsSwap = allNeedsSwap;
      console.log(`  Found: ${totalFound} instances. ${needsSwap.length} match DS components and need checking/swapping.`);
      
      if (needsSwap.length === 0) continue;
      
      // Step 2: Process in chunks
      const CHUNK_SIZE = 1;
      let totalSwapped = 0;
      let allErrors = [];
      
      // Let Figma breathe before massive import
      await new Promise(r => setTimeout(r, 2000));
      
      for (let i = 0; i < needsSwap.length; i += CHUNK_SIZE) {
        const chunk = needsSwap.slice(i, i + CHUNK_SIZE);
        if (i % 20 === 0) {
           console.log(`  Processing chunk ${Math.floor(i/CHUNK_SIZE) + 1} of ${Math.ceil(needsSwap.length/CHUNK_SIZE)}...`);
        }
        
        const chunkCode = `
        (async () => {
          const chunk = ${JSON.stringify(chunk)};
          const cache = {};
          let swappedCount = 0;
          let errors = [];
          
          // Pre-fetch unique targets for this chunk to avoid repeated awaits
          const uniqueTargets = [...new Set(chunk.map(i => i.targetKey))];
          for (const key of uniqueTargets) {
            try {
              const isVar = chunk.find(i => i.targetKey === key).isVariant;
              if (isVar) {
                cache[key] = await figma.importComponentSetByKeyAsync(key);
              } else {
                cache[key] = await figma.importComponentByKeyAsync(key);
              }
              // yield to event loop
              await new Promise(r => setTimeout(r, 200));
            } catch (err) {
               errors.push("Cache failed for " + key + ": " + err.message);
            }
          }
          
          for (const item of chunk) {
            try {
              const inst = figma.getNodeById(item.id);
              if (!inst || inst.type !== 'INSTANCE') continue;
              
              if (item.isVariant) {
                const importedSet = cache[item.targetKey];
                if (!importedSet) continue;
                
                const match = importedSet.children.find(c => c.name === item.oldProps);
                
                if (match && inst.mainComponent.key !== match.key) {
                   inst.swapComponent(match);
                   swappedCount++;
                } else if (!match && inst.mainComponent && inst.mainComponent.key !== importedSet.defaultVariant.key) {
                   inst.swapComponent(importedSet.defaultVariant);
                   swappedCount++;
                }
              } else {
                const importedComp = cache[item.targetKey];
                if (!importedComp) continue;
                
                if (inst.mainComponent && inst.mainComponent.key !== importedComp.key) {
                  inst.swapComponent(importedComp);
                  swappedCount++;
                }
              }
            } catch (err) {
              errors.push(item.id + ': ' + err.message);
            }
            
            // Yield to Figma's event loop to prevent plugin hang/disconnect
            await new Promise(r => setTimeout(r, 200));
          }
          
          return { swappedCount, errors };
        })()
        `;
        
        const chunkRes = await runFigmaCode('figma_execute', { code: chunkCode });
        totalSwapped += chunkRes.swappedCount || 0;
        if (chunkRes.errors && chunkRes.errors.length > 0) {
          allErrors.push(...chunkRes.errors);
        }
        
        // Give the node script a breather
        await new Promise(r => setTimeout(r, 500));
      }
      
      console.log(`  Total Swapped: ${totalSwapped}`);
      if (allErrors.length > 0) {
        console.log(`  Errors in chunk processing:`, [...new Set(allErrors)]);
      }
      
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }
  console.log('\\nRelinking complete!');
  },

  /**
   * Bulk cleanup spacing.
   * Usage: node bulk-operations.js bulk_cleanup
   */
  bulk_cleanup: async () => {
    console.log('Running bulk cleanup...');
    const pagesToProcess = [
      "wallet details",
      "paidlife home - dev",
      "first-time experience - dev",
      "branch selection - dev",
      "log in - dev"
    ];

    console.log("Fetching float variables...");
    const varsCode = `
      (async () => {
        const floatVars = await figma.variables.getLocalVariablesAsync('FLOAT');
        return floatVars.map(v => {
          const modes = Object.keys(v.valuesByMode);
          const val = modes.length > 0 ? v.valuesByMode[modes[0]] : null;
          return { id: v.id, name: v.name, val };
        }).filter(v => v.val !== null);
      })()
    `;
    const floatVars = await runFigmaCode(varsCode);
    
    for (const pageName of pagesToProcess) {
      console.log(`\nProcessing page: ${pageName}`);
      
      const initPageCode = `
        (async () => {
          const pageName = ${JSON.stringify(pageName)};
          await figma.loadAllPagesAsync();
          const page = figma.root.children.find(p => p.name.trim() === pageName.trim());
          if (!page) return { error: "Page not found" };
          
          await figma.setCurrentPageAsync(page);
          
          const nodes = page.findAll(n => n.type === 'FRAME' || n.type === 'GROUP' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET');
          return { nodeIds: nodes.map(n => n.id) };
        })()
      `;
      
      let res;
      try {
        res = await runFigmaCode(initPageCode);
      } catch (e) {
        console.log(`  Error loading page: ${e.message}`);
        continue;
      }
      
      if (res.error) {
        console.log(`  Skipped: ${res.error}`);
        continue;
      }
      
      const nodeIds = res.nodeIds;
      console.log(`  Found ${nodeIds.length} frames/groups to process.`);
      
      const chunkSize = 100;
      let modifiedTotal = 0;
      
      for (let i = 0; i < nodeIds.length; i += chunkSize) {
        const chunk = nodeIds.slice(i, i + chunkSize);
        console.log(`  Processing chunk ${Math.floor(i/chunkSize) + 1}/${Math.ceil(nodeIds.length/chunkSize)}...`);
        
        const processChunkCode = `
          (async () => {
            const chunkIds = ${JSON.stringify(chunk)};
            const floatVars = ${JSON.stringify(floatVars)};
            const spacingFields = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing'];
            
            let modifiedCount = 0;
            
            for (const id of chunkIds) {
              const n = figma.getNodeById(id);
              if (!n) continue;
              
              let changed = false;
              
              // 1. Change 16 to 12
              for (const field of spacingFields) {
                if (field in n && n[field] === 16) {
                  try {
                    // If it's bound, unbind it first so we can change the value
                    if (n.boundVariables && n.boundVariables[field]) {
                      n.setBoundVariable(field, null);
                    }
                    n[field] = 12;
                    changed = true;
                  } catch(e) {}
                }
              }
              
              // 2. Bind to nearest variable
              const bindField = (field, type) => {
                if (field in n && n[field] != null) {
                  if (n.boundVariables && n.boundVariables[field]) return; // already bound
                  
                  const val = n[field];
                  const candidates = floatVars.filter(v => v.name.startsWith(type + '/'));
                  let closest = null;
                  let minDiff = Infinity;
                  for (const c of candidates) {
                    const diff = Math.abs(c.val - val);
                    if (diff < minDiff) { minDiff = diff; closest = c; }
                  }
                  if (val === 0 && closest && closest.val !== 0) closest = null;
                  
                  if (closest && minDiff <= 4) {
                    try {
                      n.setBoundVariable(field, closest.id);
                      changed = true;
                    } catch(e) {}
                  }
                }
              };
              
              for (const field of spacingFields) bindField(field, 'spacing');
              
              if (changed) modifiedCount++;
            }
            return { modified: modifiedCount };
          })()
        `;
        
        try {
          const chunkRes = await runFigmaCode(processChunkCode);
          modifiedTotal += chunkRes.modified;
        } catch (e) {
          console.log(`  Error in chunk: ${e.message}`);
        }
        
        if (i + chunkSize < nodeIds.length) {
          console.log(`  Waiting 10 seconds before next chunk...`);
          await new Promise(r => setTimeout(r, 10000));
        }
      }
      
      console.log(`  Modified ${modifiedTotal} nodes in total for this page.`);
      
      console.log("Waiting 20 seconds before next page...");
      await new Promise(r => setTimeout(r, 20000));
    }
    console.log("All pages processed.");
  },

  /**
   * Reset stroke width properties of all instances to match their main component.
   * Usage: node bulk-operations.js reset_instance_strokes <fileKey>
   */
  reset_instance_strokes: async (fileKeyArg) => {
    const fileKey = fileKeyArg || targetFileKey;
    if (!fileKey) { console.error('Missing fileKey (use --file <fileKey>)'); return; }
    console.log(`\n--- Starting reset_instance_strokes for file: ${fileKey} ---`);

    const getPagesCode = `
      (async () => {
        await figma.loadAllPagesAsync();
        
        // Let's hardcode the pages that already succeeded so it doesn't do them again.
        const alreadyDone = ["first-time experience - dev", "recipient", "add money", "currency conversion", "log in - dev"];
        
        return figma.root.children
          .filter(p => !p.name.toLowerCase().includes('ignore') && p.name !== '---' && !alreadyDone.includes(p.name.trim()))
          .map(p => ({ id: p.id, name: p.name }));
      })()
    `;
    let pages;
    try { pages = await send('figma_execute', { code: getPagesCode }, 120000); } 
    catch(e) { return console.error(e.message); }
    
    if (!Array.isArray(pages)) return console.error(pages);

    let totalModified = 0;
    for (const page of pages) {
      console.log(`\nProcessing page: ${page.name}`);

      const getNodesCode = `
        (async () => {
          const page = figma.getNodeById(${JSON.stringify(page.id)});
          if (!page) return { error: "Page not found" };

          const targetNodes = [];
          const stack = [page];
          let count = 0;
          while(stack.length > 0) {
            const n = stack.pop();
            if (!n) continue;
            count++;
            if (count % 500 === 0) await new Promise(r => setTimeout(r, 40));

            if (n.type === 'INSTANCE') {
              targetNodes.push(n.id);
            }

            if ('children' in n && n.children) {
              for (let i = n.children.length - 1; i >= 0; i--) {
                stack.push(n.children[i]);
              }
            }
          }
          return { nodes: targetNodes };
        })()
      `;

      let setupRes;
      try { setupRes = await send('figma_execute', { code: getNodesCode }, 2400000); } // BUMPED TO 40 MINUTES 
      catch (e) { console.error(`  Error: ${e.message}`); continue; }

      if (setupRes.error) { console.error(`  Skipped: ${setupRes.error}`); continue; }

      const nodeIds = setupRes.nodes;
      console.log(`  Found ${nodeIds.length} instances. Processing...`);

      const BATCH_SIZE = 50;
      let pageModified = 0;

      for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
        const chunk = nodeIds.slice(i, i + BATCH_SIZE);
        console.log(`    Batch ${Math.floor(i/BATCH_SIZE)+1} of ${Math.ceil(nodeIds.length/BATCH_SIZE)}...`);
        
        const batchCode = `
          (async () => {
            const chunkIds = ${JSON.stringify(chunk)};
            let count = 0;

            for (const id of chunkIds) {
              const n = figma.getNodeById(id);
              if (!n || n.type !== 'INSTANCE') continue;

              let master;
              try { master = n.mainComponent; } catch(e) {}
              if (!master) continue;

              let changed = false;
              const fieldsToReset = [];
              if (master.strokeWeight === figma.mixed) {
                  fieldsToReset.push('strokeTopWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeRightWeight');
              } else if (master.strokeWeight !== undefined) {
                  fieldsToReset.push('strokeWeight');
              }

              for (const field of fieldsToReset) {
                  if (field in n && field in master) {
                      try {
                          const masterBinding = master.boundVariables && master.boundVariables[field];
                          const instBinding = n.boundVariables && n.boundVariables[field];

                          if (masterBinding) {
                              if (!instBinding || instBinding.id !== masterBinding.id) {
                                  n.setBoundVariable(field, masterBinding);
                                  changed = true;
                              }
                          } else {
                              if (instBinding) {
                                  n.setBoundVariable(field, null);
                                  changed = true;
                              }
                              if (n[field] !== master[field]) {
                                  n[field] = master[field];
                                  changed = true;
                              }
                          }
                      } catch(e) {}
                  }
              }
              if (changed) count++;
            }
            return { modified: count };
          })()
        `;

        try {
          const res = await send('figma_execute', { code: batchCode }, 2400000); // BUMPED TO 40 MINUTES
          if (res && res.modified) pageModified += res.modified;
        } catch(e) {
          console.error(`  Batch error: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      console.log(`  Reset strokes on ${pageModified} instances.`);
      totalModified += pageModified;
      await new Promise(r => setTimeout(r, 5000));
    }
    console.log(`\nFinished! Total instances reset: ${totalModified}`);
  },

  /**
   * Apply sentence case to all text nodes, page by page (skips pages with "ignore" in name).
   * Preserves acronyms, brand names (PaidHR, PaidLife), and words starting with two capitals.
   * Usage: node bulk-operations.js --file "ta design v2.0.2" lint_sentence_case
   */
  lint_sentence_case: async () => {
    let pages;
    try {
      pages = await send('figma_execute', {
        code: `figma.root.children.map(p => ({ id: p.id, name: p.name }))`,
      }, 60000);
    } catch (err) {
      console.error('Failed to get pages:', err.message);
      return;
    }

    const toProcess = pages.filter(p => !/\bignore\b/i.test(p.name));
    const skipped   = pages.filter(p => /\bignore\b/i.test(p.name));
    console.log(`Pages: ${toProcess.length} to process, ${skipped.length} skipped`);
    if (skipped.length) console.log(`  Skipped: ${skipped.map(p => p.name).join(', ')}`);
    console.log('');

    let grandApplied = 0, grandFailed = 0;
    for (const page of toProcess) {
      process.stdout.write(`[${page.name}] running... `);
      try {
        const r = await send('figma_execute', { code: makeSCPageCode(page.id) }, 3600000);
        grandApplied += r.totalApplied;
        grandFailed  += r.totalFailed;
        const suffix = r.totalFailed ? `, ${r.totalFailed} failed` : '';
        console.log(`${r.totalApplied} applied${suffix}`);
        if (r.fontLoadErrors && r.fontLoadErrors.length)
          r.fontLoadErrors.forEach(e => console.log('  font error: ' + e));
        r.samples.forEach(s => console.log('  ' + s));
      } catch (err) {
        console.log(`ERROR: ${err.message}`);
      }
    }

    console.log(`\nTotal applied : ${grandApplied}`);
    console.log(`Total failed  : ${grandFailed}`);
  },
};

// ─── CLI Entry ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let targetFileKey = null;
const fileIdx = args.indexOf('--file');
if (fileIdx !== -1) {
  targetFileKey = args[fileIdx + 1];
  args.splice(fileIdx, 2);
}

const command = args[0];

if (!command || !operations[command]) {
  console.error('Usage: node bulk-operations.js [--file <fileKey>] <command> [args]');
  console.error('Available commands:');
  Object.keys(operations).forEach(cmd => console.error(`  - ${cmd}`));
  process.exit(1);
}

// Update send function to support fileKey
function send(command, params, timeoutMs = 2400000) { // Default to 40 minutes globally
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:9001');
    const id = randomUUID();
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; ws.close(); reject(new Error(`Timeout on command "${command}"`)); }
    }, timeoutMs);

    ws.on('open', () => {
      const msg = { id, command, params };
      if (targetFileKey) msg.fileKey = targetFileKey;
      ws.send(JSON.stringify(msg));
    });

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

// 1. Ping
send('ping', {}, 5000).then(() => {
  operations[command](...args.slice(1)).catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}).catch(() => {
  console.error('Figlink not reachable — is the server running and plugin open?');
  process.exit(1);
});