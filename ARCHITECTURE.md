# Modular architecture

## Scope and stable contracts

The workbench is organized by responsibility across React, Python, Android and the legacy browser fallback. Module extraction preserves HTTP routes, JSON/CSV field names, native JavaScript method names, local-storage keys, original recordings, candidate-path semantics and metric definitions. Small, cohesive leaf modules remain intact: collector, Binder analyzer, protocol validator, campaigns, resource counters/quality and report-reference parsing. Translation entries remain together as a declarative bilingual catalog; runtime initialization is separate.

## Frontend

| Location | Responsibility |
|---|---|
| `frontend/src/App.tsx` | Compose the provider and workbench layout only |
| `app/useWorkbench.ts` | Connection, run/plan selection, authenticated polling and serialized UI actions |
| `app/WorkbenchContext.tsx` | Share workbench state across feature routes |
| `app/WorkbenchLayout.tsx` | Route composition and global notices |
| `app/WorkbenchHeader.tsx`, `TrialQueue.tsx`, `ReviewRail.tsx` | Sticky header and navigation, queue, protocol reference |
| `features/connection/` | Laptop/controller connection page |
| `features/plans/` | Draft/revision editing, protocol review and preflight |
| `features/runs/` | Current-trial orchestration, event/quality panel, draft-protected observations, evidence fetching and countdown |
| `features/history/`, `features/analysis/` | Archive filters, comparisons and explicitly separate teammate reference |
| `features/results/` | Communication and resource result presentation |
| `charts/` | Independent pure timeline/network/Sankey/chord options; ECharts lifecycle/resize/export renderer |
| `CommunicationCharts.tsx` | Chart view selection and stable memoized options |
| `shared/` | Form primitives, formatting, run-status predicates and native/browser storage |
| `i18n.ts`, `locales/catalog.ts` | Language initialization and translation data |
| `styles/` | Workbench foundations, chart, language-menu and responsive styles |

Only the current-trial route owns the one-second display clock. Parent polling does not replace dirty ground-truth drafts. Chart options are stable across unrelated renders, preserving stationary hover. Option generators retain original edges, opposite directions, UPIDs and fractional event times. ECharts remains lazy-loaded from the result module.

## Python backend

```text
server.py (CLI and compatibility imports)
  ├─ auth.py / contracts.py
  ├─ http_handler.py → http_transport.py
  │    ├─ http_campaigns.py
  │    ├─ http_devices.py
  │    └─ http_runs.py
  └─ run_store.py
       ├─ run_capture.py → collector.py / analyzer.py
       ├─ run_events.py → browser_detection.py / protocol.py
       └─ run_quality.py

resources.py (observer/parsing/summary compatibility surface)
  ├─ resource_capture.py (fixed-window acquisition)
  ├─ resource_compare.py (pairing and signed deltas)
  ├─ resource_contracts.py
  └─ resource_proc.py / resource_quality.py

experiments.py → behavior_classifier.py
study_export.py → experiment evaluation and complete Python source snapshot
```

`Runs` retains the existing public coordination interface: durable updates, its lock, stop/readiness events and experiment admission. HTTP knows request framing and status codes; domain modules do not import HTTP routes or the CLI. Compatibility imports from `backend.server` and `backend.resources` remain available for existing scripts/tests, while implementations live at their actual seams.

Resource fixed-window acquisition is independent of A/B/C pairing. Legacy parser semantics and the cumulative-counter observer remain distinct. Source exports include all top-level backend Python modules so the extracted dependencies are reproducible.

The fallback `backend/web/app.js` is an ES module entry. `web/legacy/client.js`, `packages.js`, `results.js` and `evaluation.js` own transport/storage, package selection, result presentation and comparison rendering. The backend serves only validated JavaScript paths within that directory; the React production bundle remains the default when built.

## Android

| Class | Responsibility |
|---|---|
| `MainActivity` | Activity/WebView lifetime and connection UI |
| `ControllerSession` | Current origin, locale and visible-Activity state |
| `ControllerBridge` | Existing allowlisted `@JavascriptInterface` methods |
| `DocumentExports` | Document-picker state, restoration and download completion |
| `LegacyRecordingNotifications` | Legacy recording alerts and overlay fallback |
| `ExperimentMarkerService` | Native foreground marker sequencing, idempotent pending events, device timers and service lifecycle |
| `MarkerApiClient` | Authenticated bounded HTTP requests, without owning timestamps/retries |
| `MarkerReceiver`, `FloatingMarkersService`, `MarkerText` | Legacy marker delivery, overlay controls and native text |

Network transport cannot regenerate an event ID or timestamp. Foreground-service startup remains guarded by visible Activity state. The marker service continues to capture device time before upload and reuse the pending event across retries. These invariants are preserved through the extraction.

## Versions and existing experiments

The rebuilt repository APK is **2.0.2 / versionCode 8**. Building and publishing the artifact does not install it on the phone; the earlier installed 2.0.1 remains unchanged until an explicit device update.

New run identities hash every top-level backend Python module, including extracted implementations. This intentionally differs from the old five-file fingerprint. Existing frozen plan snapshots and historical metadata are not migrated or rewritten to hide that change. Before further formal collection with the new backend, create/review a protocol revision and verify the current software/device configuration. Existing data remain readable and analyzable; automated software checks do not replace device acceptance. Do not edit old hashes or fabricate pilot observations to bypass the frozen identity check.

## Validation

```powershell
. D:\home\CS211\enter-env.ps1
python -m unittest discover -s tests -v
Push-Location frontend
npm test
npm run build
Pop-Location
.\android\gradlew.bat -p android --offline :app:assembleDebug
node --check backend/web/app.js
```

Regression coverage includes original backend/API tests, public-import compatibility, domain/HTTP import direction, modular source export, fallback routes/path validation, cross-route connection/draft state, chart lifecycle, fractional markers, edge accounting and language changes. The legacy browser module has an integration test for connection and package selection.

Read-only real-data comparison additionally checks all nine saved run quality results, serialized evaluation, three task trace reanalyses and hashes of 46 original evidence files. Browser acceptance covers existing results, route navigation, bilingual selection, chart variants/expansion and a 390px mobile viewport. No physical experiment or APK installation is implied by these checks.
