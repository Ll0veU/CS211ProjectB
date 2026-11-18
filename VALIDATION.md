# Validation record

## Final UI and repository checks 2026-11-18

- Replaced the native language select with a translation-icon popover, current-language checkmark and language-code badges. Keyboard navigation, Escape/outside dismissal and draft preservation are covered by tests.
- Replaced hand-built communication SVG layouts with locally bundled, on-demand ECharts. Timelines retain fractional marker positions and incoming/outgoing/internal counts. The default two-column Sankey explicitly separates sender/receiver roles so reciprocal and self requests do not create invalid cyclic flows; all directed edge weights are preserved. Network view remains available; both views support SVG export.
- Frontend: 14 tests, TypeScript and production build passed. Live W0 preview verified whole-trace/task-window switching (1,391 versus 338 requests), rendered ECharts SVGs, Sankey/network switching, Chinese/English menu operation and 390px viewport sizing without page overflow or browser warning/error logs. This was read-only result inspection; no new phone experiments were started.
- Pre-push checks also passed all 71 Python tests and offline Android assembleDebug; rebuilt and published APK SHA-256 remain identical. Dependency audit reports six high-severity findings in the existing Vite/Vitest development dependency chain, with proposed major-version changes; no ECharts advisory was reported. These dependency findings remain unresolved. The deferred chart chunk still triggers Vite's size advisory.

## Vivo pilots and protocol freeze checked 2026-11-18

- Supersedes the earlier same-day device-pending notes below: wireless ADB on vivo X80/V2183A completed six reviewed Gemini pilots in `runs/vivo-study-20261118`; all six active attempts have saved success outcomes and pass protocol checks. Operator confirmed foreground idle/no interference and unchanged conditions. Failed/misoperated attempts remain preserved and superseded.
- Accepted task runs: W0 `fd91fa19a4a14fde9bfbb351824ffd77` (30.019825925 seconds); W1 `e78f193d06214fe5a26724622cb19ff0` (12.23048577 seconds, Chrome/Wikipedia/no confirmation); W2 `25656b3c16e6424387c541ce7d847623` (8.882755 seconds speech, 13.587440693 seconds response wait). Native markers fall inside their traces; analysis warnings are empty. W2 response is explicitly an operator summary, not a verbatim transcript.
- Resource A/B/C: `75d361cc7e84401786d6c550e36f4ba3`, `a766522723324a2eb7e286fa9108907c`, `8aa2189b704f469bb651a456d049a027`. Each has 21 snapshots, matching controller-presence configuration, available Agent CPU/PSS and resolved charge change at 300 seconds. B rejects one CPU interval for changed process membership; rejection remains explicit. C's 12,205,747-byte trace parses to 303.12235448 seconds with no reported data-loss/setup warnings. These are pilots, not measured formal overhead.
- Frontend countdown regression fixed: persisted preparation deadlines no longer override resource recording deadlines. Current run precedes next actions; next actions are hidden while any capture/collection/analysis is active. Nine frontend tests, TypeScript and production build passed. Frontend-only edits occurred during A/C and are recorded in their notes; the collector backend was not restarted during sampling.
- Task-cohort signature v2 excludes Agent/package/model/account identity, plan scope and resource duration, while retaining common task controls. Regression tests first reproduced the failure, then all 71 Python tests passed. Draft upgrade records old/new derived signatures without altering full configuration hashes, pilot metadata or existing frozen plans.
- After confirming no active experiment, restarted only the owned 8766 backend and verified the authenticated live protocol API. Operator explicitly confirmed the two-package Gemini observation scope. Campaign `1b1b071c15d24d5aa8263ae9c4410f8f` is now frozen, resource window 300 seconds, resource temperature baseline 35.6 degrees C, with nine task and nine resource formal slots. SHA-256 checks confirmed all nine pre-existing run metadata files stayed unchanged during freeze.
- Frozen plan JSON, CSV, generated Chinese guide and `pilot-freeze-evidence.zip` are saved under the study's `exports/` directory. Formal Gemini repetitions, second-independent-Agent pilots/repetitions, representative path review and final reporting remain outstanding. No formal classification or causal overhead conclusion is claimed.

## Android controller updated 2026-11-18

- User requested updating the controller before starting experiments. No task/resource run or campaign had been created in `runs/vivo-study-20261118` at update time.
- Gradle offline `:app:assembleDebug` passed for **2.0.1 / versionCode 7**. Wireless ADB `install -r` returned Success and retained application UID 10303.
- Read back the installed APK and inspected all DEX files (the primary DEX is a multidex stub). The native marker service and the final stream-reading compatibility fix are present.
- Installed APK, build output and published `artifacts/apk/app-debug.apk` all have SHA-256 `abd951d90cc6320919c3c693f4075f7cec5f98ce27218ec6a1081909a35ecb42`.
- MainActivity started and a live app PID was confirmed. No AndroidRuntime error was present in the inspected startup log. This is startup acceptance, not proof of background marker/timer behavior; pilot trials remain required.

## Independent Vivo study continuation checked 2026-11-18

- User scope correction: independently repeat the teammate's resource A/B/C work on Vivo, add the outstanding Binder task matrix, export raw/derived evidence, and summarize the actual results. The teammate's OPPO resource-phase closure does not close the Vivo phase.
- Python regression/API suite: 70 tests passed. Coverage includes cumulative CPU normalization excluding iowait, guest-counter accounting, process membership changes/PID reuse, per-PID PSS identity, null readings, task-only/full plan gates, cross-Agent cohort signatures, report arithmetic, observer isolation, time/temperature warnings, authenticated ZIP/report routes, checksums and credential exclusion.
- Frontend: strict TypeScript/Vite production build and six Vitest/Testing Library tests passed. Live Chrome checks verified English/Chinese report reference boundaries, retained negative power differences and the independent Vivo export/report controls. Unit capitalization is preserved; CPU deltas are labelled percentage points.
- Teammate report audit: 9 reported runs, 9 quality rows and 12 difference rows parsed with a source SHA-256. All 108 arithmetic checks passed at 0.002 rounding tolerance. This verifies report-table consistency only; the OPPO raw archive is absent locally.
- Local dataset audit: one historical Vivo W1 recording. JSON/CSV/timeline agree at 32 selected-package requests; missing prompt/browser markers, browser package and reviewed attribution prevent formal acceptance. No new Vivo experiment results are claimed.
- Offline ZIP export was generated and every manifest hash verified for 22 source/data/report entries; original run bytes are preserved and access codes/logs are excluded. Interim reports explicitly state that the study is in progress.
- Physical gate pending: Windows lists vivo X80 and an ADB interface, but both native and isolated libusb ADB enumerations returned no devices. No new USB/wireless captures, resource triplets, phone marker trials or second-Agent matrix were performed. The independently implemented cumulative observer still requires a Vivo capability/short-run check.
- The automatic approval system rejected the command containing a stop/restart of the previous backend. The existing process was left running; it does not yet expose the latest study-export API. Offline exports and test-server API verification succeeded. Restart the backend before using new live collection/export behavior.

## Resource extension checked 2026-11-07

- Current-source regression suite: 32 tests passed (19 existing tests and 13 new resource tests). New tests cover CPU normalization and process matching, PSS deduplication, missing readings, battery units and invalid states, stale/overlapping CPU windows, arm contamination, controller-only force-stop, tracing only in arm C, early stop, triplet/version/duplicate rules, signed deltas, resource/legacy isolation, API validation and authenticated resource exports.
- Android APK 1.4 (`versionCode 5`) built successfully with Gradle 8.14, installed SDK and JDK. Deprecation warnings remain.
- JavaScript syntax check passed. Headless Chrome desktop and 390-pixel mobile layouts with mocked API/native bridge passed resource setup, acknowledgment, capability flags, unavailable-value rendering, APK resource-start restriction, resource export and evaluation checks. This is not Android lifecycle/device validation.
- Read-only evaluation of the existing primary dataset still lists 10 ordinary run comparisons and zero resource triplets. Existing raw traces and ground-truth files were not modified by this update.
- No phone was connected during this change. CPU/PSS availability, actual battery counter resolution, force-stop/reopen workflow, resource collector cost, controller background survival, raw trace completeness and usable three-arm differences remain **pending real-device acceptance**. No measured CPU/memory/energy overhead is claimed yet.

## Earlier implementation record

Checked on 2026-11-05 after the original course requirements review.

- `python -m unittest discover -s tests -v`: 9 tests passed. Tests cover request/reply accounting, shared UID attribution, API authentication and experiment lifecycle, baseline without Perfetto, evidence download after analysis failure, marker validation, overhead pairing and ambiguous duplicate rejection, failure retention, and classifier abstention/separated synthetic workloads.
- `node --check backend/web/app.js`: passed.
- Android Gradle 8.14 offline `:app:assembleDebug`: successful with the installed SDK. The updated APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Deprecation warnings remain; no compilation failure.
- Real reference trace reanalysis using installed Perfetto dependencies: 544 selected requests, 528 matched synchronous calls, timeline sum 544. The reference trace reports `ftrace_setup_errors: 4`; it is a regression fixture, not an accepted Agent experiment.
- Headless Chrome, 390 × 844 viewport, mocked backend/native bridge: frontend initialization from saved native state, failed trace download button, baseline selection, 90-second W2 capture margin, and evaluation rendering passed with no JavaScript page errors.

Not validated on a physical phone: wireless tracing permissions, APK Activity recreation, notification marker delivery, document-picker exports, timing accuracy, newly created Agent process attribution, actual workload support, and overhead. Browser mocks do not validate Android lifecycle or Binder collection. No formal Agent results or classification accuracy are claimed.
