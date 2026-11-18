# Experiment workbench v2

## Run locally

Use Node 24 and Python 3.10+. From the repository root:

```powershell
Push-Location frontend
npm ci
npm run build
Pop-Location
python -m backend.server --host 0.0.0.0
```

The Python server serves the production React bundle and API together on port 8765. Restrict LAN access to your trusted network. For development, run `npm run dev` in `frontend`; Vite proxies `/api` to port 8765. No external fonts, analytics, or runtime CDN dependencies are used.

The header language button opens a keyboard-accessible Chinese/English menu. Communication results use locally bundled ECharts, loaded on demand: stacked request timelines support direction legends, event markers, zoom and SVG export. Directed interactions default to a two-column Sankey view (senders on the left, receivers on the right), with the network graph available as an alternative. A process may appear on both sides in separate roles; each band represents one observed directed edge and its request count, not a verified multi-hop causal path. All edges are retained, and full identities/counts are available on hover and in the existing detail table. Charts resize with the viewport and follow the selected whole-trace/task window and language without modifying stored evidence.

On this workstation, `. D:\home\CS211\enter-env.ps1` selects the existing Python/ADB/Perfetto environment. Do not assume a checkout-local `.venv` already exists. The existing environment was created without pip; use its installed dependencies or create an independent environment when necessary.

## Update the Android controller

The current device-verified release is **2.0.1 / versionCode 7**. It includes the final stream-reading compatibility fix. The installed APK, Gradle output and `artifacts/apk/app-debug.apk` were checked to have identical SHA-256 hashes before starting the new Vivo campaign. Advance Android versionCode for future installed builds so version labels distinguish actual artifacts.

```powershell
.\android\gradlew.bat -p android :app:assembleDebug
adb -s YOUR_DEVICE install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Version 2.0 adds a user-armed foreground marker service. Open the APK on the same phone, enter the backend address/access code, allow notifications, and optionally enable overlays. Start a task from the laptop. When the run says **Waiting for phone markers**, tap **Arm phone markers** in the visible APK and wait for **Recording** before returning to Gemini. A saved marker is acknowledged by the backend; a failed upload remains pending with its original ID and timestamp. Do not infer successful upload from a button tap.

For resource arms B/C, tap **Prepare background resource profile** in the controller before switching to Gemini. This stops task-marker services. Arm A stops only the controller and requires the explicit checkbox on the laptop. Do not reopen it during A.

## Create and review an experiment

The teammate report closes only their OPPO W0 resource phase. The user's Vivo study must independently repeat resource A/B/C and add the missing Binder task experiments, data exports and summary report. New UI plans therefore default to **Full phone study**: six pilot slots, followed by nine task and nine resource slots after review. Task-only plans remain available for a second independent Agent's W0/W1/W2 matrix. The logical Agent ID is explicit (for example `gemini`); use a genuinely independent second Agent. Create a revision to change scope rather than altering a frozen plan. OPPO results cannot satisfy Vivo acceptance gates.

The Comparisons page can read `weekly_report.md` as a source-hashed **reference snapshot**. Its OPPO measurements are not imported as Vivo run records. The cited archive and the 26 OPPO raw runs are not present in this checkout, so raw-data reproduction remains unverified. Units, negative deltas, the delayed/cooler repetition 3 arm A, and the energy-resolution caveat remain visible.

Current resource exports include sampling-quality and comparability context: valid CPU sample counts, rejected samples, failed diagnostic commands, temperature/level ranges, battery window, observer wall time and trace size. Start gaps over 30 minutes and temperature spans over 2°C are descriptive flags, not automatic exclusions. New resource captures use the independently implemented cumulative-counter `adb-proc-stat-v2` observer with per-PID PSS; see [RESOURCE_V2.md](RESOURCE_V2.md) for formulas and device acceptance. Historical `adb-dumpsys-v1` summaries keep their original interpretation. Aggregate groups preserve observer and campaign identity, and new runs record backend source hashes. The teammate collector has not been imported or validated by displaying reference metrics.

1. Connect and select the ADB device. Create a plan with the actual account label, model/mode, network, brightness, volume, read-aloud setting and browser package.
2. Review the candidate Gemini observation group (`bard` plus Google App). A group total is an observation scope, not a claim that every Google App operation was caused by Gemini.
3. Run the six pilot slots in order: W0/W1/W2 and resource A/B/C. Review ground truth, native timestamps, trace alignment, package attribution, CPU/PSS and battery resolution.
4. A task's outcome is independent of its evidence validity. Save failures and timeouts honestly. Missing historical markers cannot be repaired by guessing timestamps.
5. Freeze only after reviewing all pilots. The server verifies pilot records and identity consistency, then creates nine task and nine resource slots with counterbalanced order.
6. A configuration change creates a revision and fresh pilots. Retry only for documented protocol/infrastructure problems. Resource retries replace the full three-arm block, preserving previous records.
7. Export JSON, CSV and the English/Chinese guide from the plan. The guide is generated from the saved protocol snapshot, so its instructions and field requirements match the UI.

The W2 response deadline is 60 seconds after **Voice end**. Voice input duration, response wait and total duration are separate. W0's device timer records its actual firing time after 30 seconds. All manual markers still include operator reaction delay. Browser detection identifies a foreground browser; the operator must verify the actual URL and visible webpage.

## Data and compatibility

- The canonical protocol is `backend/experiment_protocol.json`; each plan saves a snapshot and fixed-condition signature.
- Task comparison signature v2 excludes Agent/package/model/account identity, plan scope and resource duration. Shared task controls still define the cohort. Freezing a reviewed draft upgrades its derived signature with an audit entry; full configuration hashes, saved pilot records and previously frozen plans remain intact.
- Plans live in ignored `runs/.campaigns/`. Existing run files retain their original schema and interpretation.
- Independent reanalysis lives in `runs/.analyses/<source-run>/<analysis-id>/`, with the source SHA-256. It cannot make an incomplete historical run eligible.
- Package-group Binder requests are deduplicated by transaction identity. Resource PSS is deduplicated by PID. Partial readings remain unavailable rather than silently summing incomplete data.
- Protocol evidence, outcome, attribution, capture status and metric availability are shown separately. Missing battery resolution does not erase usable CPU/PSS results.
- Cross-Agent accuracy is not presented for a single logical Agent. Pilot and superseded records do not enter formal comparisons.

## Validation

```powershell
python -m unittest discover -s tests -v
Push-Location frontend
npm run typecheck
npm test
npm run build
Pop-Location
```

Automated tests and browser mocks do not establish physical phone lifecycle behavior, marker delivery, CPU/PSS availability, or battery resolution. Six pilot runs and their operator observations are a required device acceptance gate, followed by the formal trials. Do not mark those gates complete from software tests alone.

For task-only plans the device gate consists of three task pilots. USB is useful for setup and diagnostic captures; the course's formal Binder trials use wireless ADB. A USB-powered run cannot serve as an unplugged battery/energy comparison. Enable Developer options and USB debugging, unlock the screen and accept this computer's RSA authorization prompt. `adb devices -l` must show `device` before continuing; an entry in Windows Explorer alone does not prove ADB works. Once USB is authorized, connect the controller to `http://LAPTOP_LAN_IP:8765` on the trusted network; use the phone's Wireless debugging screen to pair and connect before formal collection. Pairing and debugging ports differ and change when wireless debugging restarts.
