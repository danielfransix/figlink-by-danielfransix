# Figlink Codebase Improvement Plan

Audit of all files in `codebase/` — identifying error handling gaps, unhandled edge cases, structural problems, and best practice violations.

**Files audited:**
- `start.js` — Launcher, file watcher, prompt loader
- `link-server/server.js` — WebSocket message router
- `figma-plugin/code.js` — Plugin Figma API command handler (898 lines)
- `figma-plugin/ui.html` — Plugin UI and WebSocket client
- `tools/figma.js` — CLI WebSocket client
- `tools/process.js` — Bulk standardization orchestrator

---

## 1. Error Handling Gaps

### 1.1 Silent failures that hide real problems

| File | Lines | Issue | Fix |
|------|-------|-------|-----|
| `server.js` | 17 | JSON parse failure silently returns — no log | Log `[server] bad message from client: ${raw}` before returning |
| `server.js` | 70–72 | `fs.readFileSync` failure silently falls back to cached prompt | Log a warning: `[server] could not re-read prompt from disk, using cached version` |
| `server.js` | 32–36 | If sender is closed, pending entry is **never deleted** — memory leak | Always call `pending.delete(msg.id)` regardless of sender state |
| `code.js` | 222, 405, 408, 572 | Empty `catch (_) {}` blocks in style resolution, variable import, variable resolution | At minimum log to `console.warn` so the Figma console captures them |
| `start.js` | 154–174 | Port cleanup `taskkill` failures are swallowed with no indication | Log `[start] warning: could not kill PID ${pid}: ${e.message}` |
| `start.js` | 196–204 | `serverProcess.send()` failure only logs once, subprocess state unclear | After catching the error, explicitly kill the server and restart |

### 1.2 Error context too thin

| File | Lines | Issue | Fix |
|------|-------|-------|-----|
| `code.js` | 29–34 | `catch(err)` only sends `err.message` — type and stack are lost | Include `err.name`; e.g. `{ error: err.message, errorType: err.name }` |
| `tools/figma.js` | 99–104 | Timeout message doesn't distinguish server-down vs plugin-not-connected | Check WS connection state; if connected say "Plugin did not respond", else "Server not running" |

### 1.3 Unsafe data access without guards

| File | Lines | Issue | Fix |
|------|-------|-------|-----|
| `code.js` | 459–474 | `fillIndex` used to index `fills[]` without bounds check | Validate `fillIndex >= 0 && fillIndex < fills.length`, throw descriptive error if not |
| `tools/process.js` | 188–189 | `Object.values(v.valuesByMode)[0]` — `valuesByMode` could be empty | Guard: `const val = Object.values(v.valuesByMode)[0]; if (val === undefined) continue;` |
| `tools/process.js` | 140–145 | `findClosestFloat` accesses `.val` on an object that could be undefined | Add null-check on candidate before accessing `c.val` |
| `tools/process.js` | 130 | `findClosestFloat` can return `null` — caller pushes it into array unchecked | Check `if (best)` before pushing to `bindingItems` |

### 1.4 Partial batch failures leave inconsistent state

| File | Lines | Issue | Fix |
|------|-------|-------|-----|
| `tools/process.js` | 264–267 | Chunked `bulk_set_variable_binding` — if chunk 3/5 fails, chunks 1–2 already applied | Collect all chunk errors and report a summary at end; consider a dry-run first pass |

---

## 2. Edge Cases Not Covered

### 2.1 Connection / identity collisions

| File | Lines | Issue | Fix |
|------|-------|-------|-----|
| `server.js` | 20–27 | Two plugins connecting simultaneously both get `unnamed-${Date.now()}` — second overwrites first | Use `unnamed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` for uniqueness |
| `server.js` | 78–95 | Rapid disconnect/reconnect with different `fileKey` leaves orphaned map entries | On reconnect, check if old entry for same socket exists and clean it up |
| `server.js` | — | No TTL on `pending` entries — hanging plugins accumulate entries forever | Add a 30s cleanup sweep: `setInterval(() => { /* purge stale pending */ }, 30000)` |

### 2.2 Input and parameter edge cases

| File | Lines | Issue | Fix |
|------|-------|-------|-----|
| `code.js` | 44–45 | `serializeNode` with negative `depth` — no infinite recursion but still wasteful | Clamp: `const d = Math.max(0, depth)` at function entry |
| `code.js` | 283–289 | `getNodesFlat` has no result size cap — large documents could exhaust memory or exceed WS message limits | Add optional `limit` param (default 5000); return `{ truncated: true }` flag if hit |
| `code.js` | 731–744 | Variant property parsing splits on `','` and `'='` — breaks if variant names contain those chars | Use Figma's `variantProperties` API property directly instead of parsing from name |
| `code.js` | 518–523 | `setProperty(nodeId, field, value)` — `field` can be any property, including read-only ones | Maintain an explicit whitelist of settable fields (see Section 4.5 below) |
| `start.js` | 83–90 | `prompt_id` is sanitized but path traversal is not fully blocked | After sanitizing, verify the resolved path starts with `PROMPT_FILES_DIR` |

### 2.3 No quality thresholds in matching logic

| File | Lines | Issue | Fix |
|------|-------|-------|-----|
| `tools/process.js` | 120–145 | `findClosestColor`, `findClosestFloat`, `findClosestTextStyle` always return "least bad" even if very far off | Add a `maxDist` param; return `null` if no candidate is within it. Example: skip color binding if RGB distance > 30 |

### 2.4 Platform / environment edge cases

| File | Lines | Issue | Fix |
|------|-------|-------|-----|
| `start.js` | 156–163 | `netstat` column parsing assumes PID is last column — breaks on non-English Windows locales | Filter on `LISTENING` state and document the locale assumption |
| `figma-plugin/ui.html` | 398 | Retry uses a flat 2500ms delay — hammers the port if server is down for minutes | Implement exponential backoff with jitter: `Math.min(30000, 2500 * 2^attempt) + rand(0, 500)` |
| `figma-plugin/ui.html` | 419 | `pendingMessages` capped at 10 — messages silently dropped beyond that | Show a visible "reconnecting, some messages lost" state in the UI |

---

## 3. Code Structure Issues

### 3.1 `code.js` is too large (898 lines, 40+ commands in one file)

Split by domain into a `commands/` folder:

```
figma-plugin/
  code.js              ← Entry point: init + router only (~50 lines)
  commands/
    query.js           ← get_nodes, get_selection, get_pages, etc.
    styles.js          ← apply_text_style, duplicate_text_style, etc.
    variables.js       ← set_variable_binding, getAllAvailableVariables, etc.
    text.js            ← set_characters, bulk_set_characters
    components.js      ← clone_component_set, swap_button_instances
    properties.js      ← rename_node, set_property, bulk_rename
  serializers.js       ← serializeNode, serializeFills, serializeBoundVariables
```

### 3.2 Deeply nested logic in `swapButtonInstances` (`code.js:792–896`)

5+ levels of nesting. Extract:
- `matchVariantComponent(newSet, variantProps)` — find the matching component from variant properties
- `copyTextContent(sourceInstance, targetInstance)` — isolate text preservation logic

### 3.3 Inconsistent error handling patterns across `code.js`

Four different styles exist in the same file: empty catch, throw, return-error-object, silent continue. Standardize:
- **Command handlers**: Always throw — the top-level dispatcher (lines 29–34) catches and serializes
- **Helper functions**: Throw with descriptive messages, never swallow
- **Bulk operations**: Per-item try/catch, accumulate `{ ok: false, id, error }` — never stop the loop

### 3.4 `processStandardization` (`tools/process.js:182–273`) does too many things in 90 lines

Split into single-purpose helpers:
```javascript
processRenames(node, data)             // TEXT and FRAME renaming
processTextStyleBindings(node, data)   // Match + bind text styles
processColorBindings(node, data)       // Match + bind color variables
processSpacingBindings(node, data)     // Match + bind spacing/radius
processClipContent(node)               // Set clipsContent
```
`processStandardization` then becomes a clean coordinator.

### 3.5 `start.js` has too many responsibilities

Extract into modules:
```
codebase/
  lib/
    promptLoader.js    ← loadActivePrompt()
    portCleanup.js     ← freePort()
    serverManager.js   ← spawnServer(), setupFileWatcher()
  start.js             ← Orchestrates the above (~50 lines)
```

---

## 4. Best Practice Improvements

### 4.1 Magic numbers — replace with named constants

Across all files:

| Location | Value | Suggested constant |
|----------|-------|--------------------|
| `start.js:129` | `100 * 1024` | `MAX_PROMPT_SIZE_BYTES` |
| `start.js:257–258` | `300` | `FILE_WATCH_DEBOUNCE_MS` |
| `start.js:188`, `server.js:5`, `ui.html:298` | `9001` | `WS_PORT` |
| `tools/figma.js:104` | `15000` | `COMMAND_TIMEOUT_MS` |
| `tools/process.js:263` | `500` | `BULK_BINDING_CHUNK_SIZE` |
| `tools/process.js:103` | `300000` | `STANDARDIZE_TIMEOUT_MS` |
| `figma-plugin/ui.html:398` | `2500` | `WS_RETRY_BASE_MS` |
| `figma-plugin/ui.html:419` | `10` | `MAX_PENDING_MESSAGES` |

### 4.2 Font loading is redundant per node (`code.js:434, 588–598`)

`figma.loadFontAsync` is called once per text node even when the same font was just loaded. Add a cache:

```javascript
const loadedFonts = new Set();

async function ensureFontLoaded(fontName) {
  const key = `${fontName.family}:${fontName.style}`;
  if (!loadedFonts.has(key)) {
    await figma.loadFontAsync(fontName);
    loadedFonts.add(key);
  }
}
```

Reset `loadedFonts` at the start of each bulk operation.

### 4.3 Sequential page processing is slow (`tools/process.js:280–284`)

For files with 10+ pages the current `await` loop creates unnecessary latency. Use limited parallelism:

```javascript
const CONCURRENCY = 3;
for (let i = 0; i < targets.length; i += CONCURRENCY) {
  await Promise.all(
    targets.slice(i, i + CONCURRENCY).map(({ id, name }, j) => {
      console.log(`  [${i + j + 1}/${targets.length}] ${name}`);
      return processStandardization(id, data).catch(e => {
        console.warn(`  ✗ ${name}: ${e.message}`);
      });
    })
  );
}
```

### 4.4 Active prompt re-fetched on every command (`tools/process.js:306–309`)

`get_active_prompt` consumes ~5s of the timeout budget on every run. Cache it:

```javascript
let cachedPrompt = null;
async function getActivePrompt() {
  if (!cachedPrompt) cachedPrompt = await sendCommand('get_active_prompt', {}, 5000);
  return cachedPrompt;
}
```

### 4.5 `setProperty` allows setting any Figma property (`code.js:518–523`)

```javascript
const SETTABLE_PROPERTIES = new Set([
  'name', 'visible', 'opacity', 'blendMode',
  'clipsContent', 'layoutMode', 'primaryAxisSizingMode',
  'counterAxisSizingMode', 'paddingLeft', 'paddingRight',
  'paddingTop', 'paddingBottom', 'itemSpacing',
  'cornerRadius', 'topLeftRadius', 'topRightRadius',
  'bottomLeftRadius', 'bottomRightRadius',
]);

function setProperty(nodeId, field, value) {
  if (!SETTABLE_PROPERTIES.has(field))
    throw new Error(`Property "${field}" is not in the allowed list`);
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  node[field] = value;
  return { ok: true, nodeId, field, value };
}
```

### 4.6 File deletion race condition (`tools/process.js:346–350`)

Replace `fs.unlinkSync` with:
```javascript
fs.rmSync(filePath, { force: true }); // no-ops safely if file doesn't exist
```

---

## 5. Prioritized Action List

### Critical — fix these first (stability / correctness)

1. **`server.js:32–36`** — Always `pending.delete(msg.id)` even when sender is closed
2. **`server.js`** — Add 30s TTL sweep for orphaned `pending` entries
3. **`code.js:459–474`** — Add `fillIndex` bounds check before accessing `fills[]`
4. **`tools/process.js:188–189`** — Guard `Object.values(v.valuesByMode)[0]` against empty object
5. **`code.js:518–523`** — Add property whitelist to `setProperty`
6. **`tools/process.js:120–145`** — Add match quality thresholds (color, spacing, text style)

### Important — reliability / debugging

7. Replace all empty `catch (_) {}` blocks with at least `console.warn`
8. **`server.js:20–27`** — Add random suffix to `unnamed-${Date.now()}` fileKey
9. **`ui.html:398`** — Implement exponential backoff on WebSocket retry
10. Replace all magic numbers with named constants
11. **`code.js:434`** — Add font loading cache
12. **`tools/process.js:280–284`** — Parallelize page processing (concurrency = 3)

### Structural — maintainability

13. Split `code.js` into a `commands/` folder by domain
14. Break `processStandardization` into single-purpose helper functions
15. Extract `start.js` utilities into `lib/` modules
16. Standardize error handling across all of `code.js` (throw everywhere, dispatcher serializes)

---

## Verification Checklist

After applying fixes:

- [ ] `node codebase/start.js` starts cleanly with no errors
- [ ] `node tools/figma.js get_nodes` returns a response from the plugin
- [ ] `node tools/process.js --file <key> standardize <nodeId>` completes without crashing
- [ ] Force-disconnect the Figma plugin mid-command — verify server logs the failure and recovers
- [ ] Call `setProperty` with a non-whitelisted field — verify it throws a clear error
- [ ] Pass `depth: -1` to `get_nodes` — verify it clamps to 0 without error
- [ ] Delete the prompt file mid-run — verify server logs a warning instead of silently using stale content
