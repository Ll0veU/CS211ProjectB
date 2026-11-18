# Resource collector v2 (2026-11-16)

Use `C:\CS211ProjectB` as the main repository. This update changes the backend and desktop page; it does not require reinstalling APK 1.5.

## Find X7 / Gemini settings

- Agent package: `com.google.android.googlequicksearchbox`. The observed Gemini foreground activity is `com.google.android.apps.search.assistant.surfaces.voice.robin.main.MainActivity`. `com.google.android.apps.bard` did not represent the running Gemini processes on this phone.
- Device label: `OPPO-FindX7-Android16`.
- Conditions: start a fresh series, e.g. `resource-pilot-v2`. Keep this identical across A/B/C, together with repetition, workload, duration, sample interval and settling time.
- Pilot: W0 idle, repetition 1, duration 300 seconds, interval 15 seconds, settling 30 seconds. Gemini stays foreground, screen stays on, and charging must be disconnected before Start. Use wireless ADB.
- A: `Resources A`, acknowledge stopping only Project B. Do not reopen it during capture.
- B: reconnect Project B first, then return to Gemini. Select `Resources B`, leave the A acknowledgment unchecked.
- C: same app state as B, select `Resources C`. Keep Simpleperf disabled for the standard A/B/C overhead series; collect it in separate diagnostic runs.
- Let the fixed window finish automatically. Do not manually stop at 300 seconds. Confirm the scenario outcome only after checking that it actually followed the protocol.

## Measurement changes

`adb-proc-stat-v2` replaces cached `dumpsys cpuinfo` windows with differences of cumulative `/proc/stat` and `/proc/PID/stat` counters. The first snapshot establishes the baseline: 21 snapshots normally produce 20 CPU intervals. System busy CPU excludes idle and I/O wait, and excludes duplicate guest counters. Process CPU uses device `CLK_TCK`, a host read-midpoint interval, and a one-core percentage scale. Process groups are matched by full command line; PID reuse, missing reads and process-set changes invalidate the affected interval and establish a new baseline. Short-lived or isolated workers can still be missed. Google app process totals are not uniquely attributable to Gemini alone.

The voltage fallback checks the PHZ110 model, OPLUS gauge path and battery model. Only that profile interprets the observed four-digit gauge value as mV. Standard microvolt values are converted separately. Other unknown values remain unavailable. Raw source, unit and evidence are retained. Windows ADB CRLF output is supported.

The unit rule is corroborated by [OPPO's published Find X7 MTK driver](https://github.com/oppo-source/android_kernel_modules_oppo_mt6989/blob/oppo_mt6989_u_14.0.1_oppo_find_x7/vendor/oplus/kernel/charger/v2/oplus_chg_gki.c#L528): the MTK branch exports the gauge value directly; the alternative multiplies by 1000. This older published source is not proof of the exact Android 16 binary and is not hardware calibration. See also the [Linux power supply ABI](https://docs.kernel.org/power/power_supply_class.html) and [proc counter documentation](https://docs.kernel.org/6.1/filesystems/proc.html).

Energy remains a whole-device charge-times-voltage estimate, not Gemini energy. It requires a real, continuously discharging window of at least 120 seconds, a monotonic positive charge decrease and a consistent supported voltage source. Counter quantization can make short runs unavailable. ADB collection overhead is retained in every arm.

Start guards reject charging or a foreground package different from the selected target. New summaries invalidate protocol comparisons if power state is unsuitable during capture. Old raw data is preserved; known charging-contaminated legacy runs are excluded from matched comparisons. Legacy and v2 collectors are separated both when matching triplets and when aggregating repetitions.

## Acceptance

Check each new pilot for the correct observer and target, approximately 20 valid CPU intervals, A controller absent/B and C present, supported voltage, no charging or protocol issues, and usable charge resolution. A matched triplet alone is not proof that every metric is valid. Repeat complete, counterbalanced A/B/C sets only after the new pilot passes. Automated diagnostic captures are engineering validation, not formal project results.

## Validation evidence (2026-11-16)

- 51 Python tests passed, plus JavaScript syntax and existing Simpleperf UI wiring checks.
- Live wireless ADB diagnostic: 136.26 seconds, 10 snapshots, 9/9 valid CPU intervals, no protocol issues or rejected intervals. Median system CPU 4.72%, Google app process group 1.15% of one core, controller 0.46% of one core.
- Battery window 134.86 seconds, charge decrease 10,000 uAh, estimated whole-device energy 40.612 mWh (about 1084 mW). This validates data availability only, not an overhead claim.
- That diagnostic exposed a separate package-name PSS lookup failure. The final implementation reads meminfo for each discovered PID, verifies the returned PID/name, and sums only when all members are readable. A follow-up live check confirmed Google app group PSS is available; raw before/after evidence is preserved under the deployment backup's validation directory.
- The 135-second diagnostic preceded the PID-based PSS fix. Its CPU/battery evidence remains valid as an engineering check, but it is not a complete formal A/B/C result. Run a fresh 300-second A/B/C pilot with the final collector.
