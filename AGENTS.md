# Repository Guidelines

## Project Structure & Module Organization

- `backend/`: Python collection, Binder analysis, evaluation, resource measurement, and HTTP API. `trace.pbtx` configures Perfetto; `web/` contains shared HTML, CSS, and JavaScript.
- `android/app/src/main/`: Java controller, notification/overlay markers, and manifest. Gradle configuration and wrapper live in `android/`.
- `tests/`: regression and mocked API tests. `artifacts/apk/app-debug.apk` is the tracked debug APK.
- `frontend/`: React/TypeScript workbench, bilingual resources, and component tests. `backend/experiment_protocol.json` is the canonical protocol; plans store immutable snapshots.
- Keep `frontend/src/App.tsx` as composition only. Routes/state live in `src/app`, business views in `src/features`, pure chart options/runtime in `src/charts`, common UI/storage in `src/shared`, styles in `src/styles`, and translation data in `src/locales`.
- `backend/server.py` is the CLI/compatibility entry; HTTP belongs in `http_*`, durable coordination in `run_store`, capture/events/quality in `run_*`, and resource acquisition/comparison in `resource_*`. Domain modules must not import HTTP or CLI modules. See `ARCHITECTURE.md`.
- Android Activity lifecycle, JavaScript bridge, document export, legacy alerts and marker HTTP transport have separate classes. Preserve native bridge method names, pending event IDs/device times, and visible-Activity foreground-service startup.
- `runs/`: generated traces and exports; ignored by Git. Consult `PLAN.md`, `NEXT_WEEK_PLAN.md`, and `VALIDATION.md` for requirements and acceptance status.

## Build, Test, and Development Commands

Run PowerShell commands from the repository root. Prerequisites: Python 3.10+, JDK 17, Android SDK platform 35, and ADB on `PATH`.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m backend.server
```

These commands create/activate the environment, install dependencies, and serve `http://127.0.0.1:8765`. Add `--host 0.0.0.0` for trusted-LAN phone access.

- `.\android\gradlew.bat -p android :app:assembleDebug`: build `android/app/build/outputs/apk/debug/app-debug.apk`.
- `python -m unittest discover -s tests -v`: run regression tests.
- `node --check backend/web/app.js`: check JavaScript syntax; requires Node.
- In `frontend`, run `npm ci`, `npm run build`, and `npm test`; the Python server serves the resulting `dist/` on port 8765.
- `python -m backend.experiments`: evaluate runs into `runs/evaluation.json`.

## Coding Style & Naming Conventions

Use four-space indentation for Python and Java, and two spaces for JavaScript. Follow existing compact CSS formatting. Use `snake_case` for Python functions/modules, `PascalCase` for classes, `camelCase` for Java/JavaScript methods and variables, and `UPPER_SNAKE_CASE` for constants. No formatter or linter is configured; follow neighboring code.

## Testing Guidelines

Use standard-library `unittest` and `unittest.mock`; name files `test_*.py` and methods `test_*`. Cover changed accounting, authentication, lifecycle, or resource logic. Mock ADB/capture operations and use temporary directories. No coverage threshold is configured. Record real-phone checks separately in `VALIDATION.md`; mocks cannot establish Binder capture, marker timing, or measured overhead.

Use Vitest and Testing Library for draft persistence, translated workflows, and API failure behavior. Keep simulated plans outside real run directories. Explain non-obvious timing, attribution, and compatibility decisions with English comments.

After moving analysis code, verify source fingerprints and bundle dependencies. Never rewrite old frozen identity hashes to make new software appear unchanged; keep physical acceptance separate from build/test results.

## Commit & Pull Request Guidelines

Follow the initial import commit's concise imperative style, with subjects such as `Fix resource triplet validation`. PRs should describe behavior changes, link relevant issues or plan items, list checks and device limitations, and include screenshots for UI changes.

## Security & Configuration

Keep `.access-token`, `.env`, signing keys, `local.properties`, and experiment data out of Git. Restrict LAN HTTP access to trusted networks. Preserve unavailable measurements and distinguish inferred relationships from verified evidence.
