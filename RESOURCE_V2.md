# Vivo resource measurement protocol

The Vivo experiment independently repeats the teammate's A/B/C resource design. The OPPO report supplies method definitions and metric names; its numerical results do not count as Vivo observations. The local `projectb-proc-counter-1` implementation is independently written and requires a Vivo capability/short-capture check before formal runs. Backend source hashes, device build, package versions and trace configuration are recorded.

## Counter definitions

- Read `/proc/stat` cumulative CPU counters. Exclude guest counters (already included in user/nice). System CPU is `100 × (Δtotal − Δidle − Δiowait) / Δtotal`.
- Identify package-shaped processes from `ps`. Read each selected PID's `/proc/PID/stat`, command line, PSS, and stat again. A changed start time, inconsistent command line, exited process or reused PID leaves the reading unavailable.
- Process CPU is `100 × Δ(utime + stime) × logical_CPU_count / Δsystem_total`. This is a percentage relative to one logical core. CPU-count changes invalidate the interval. The first snapshot establishes a baseline; it is neither a zero nor a valid CPU interval.
- Changed process membership invalidates the affected group's CPU interval; system CPU can remain usable. Per-package and group metrics retain separate valid counts. Short-lived or isolated processes without sufficient package evidence may be missed.
- PSS uses `dumpsys meminfo -s PID` and verifies the returned PID. Sum each confirmed PID once; partial unreadable groups remain null. An independently confirmed absent controller in A can be zero.
- System memory is `MemTotal − MemAvailable`, in KiB. Battery energy uses successive charge-counter decreases and mean endpoint voltages, in mWh; mean power uses the actual battery observation window, in mW.
- On Vivo, use a plausible voltage explicitly reported in mV. No OPPO-specific unit multiplier is copied. Invalid voltage, charging, unresolved discharge, reset counters and unsupported readings retain explicit unavailability reasons.

## Experimental controls and interpretation

Use A/B/C, B/C/A and C/A/B for repetitions 1–3. All arms retain the same ADB observer. Start from the laptop, allow 30 seconds of preparation, observe 300 seconds, and sample every 15 seconds. Capability tests are diagnostic and excluded from the formal triplets. Extend and repeat all formal triplets consistently if a longer battery window is required.

A keeps the Agent foreground and stops only Project B. B retains the connected controller in the background with task markers disabled. C adds Perfetto. Keep the same phone, network, brightness, screen state and app versions; unplug USB/charging for energy trials and use wireless ADB. Respect the agreed cooldown and temperature window. Save the true outcome and any deviation.

Retain raw diagnostics, sample timings, valid counts, command errors, temperature/charge ranges, trace size and observer wall time. Wall time is not CPU time. Report signed B−A, C−B and C−A differences per triplet, followed by median/range/n across triplets. CPU deltas are percentage points. Counter resolution and whole-device background changes limit energy attribution; a negative delta is not proof of savings.

The old `adb-dumpsys-v1` summaries remain unchanged and separate. Observer/version/implementation/device identities must not be pooled. Source-file hashes also prevent unacknowledged implementation changes within a frozen campaign.

## Export

The Comparisons page exports `vivo-study-evidence.zip` with original traces/JSON/CSV, saved plans, `evaluation.json`, English/Chinese reports, relevant source/configuration and `manifest.sha256.json`. Access codes and server logs are excluded. Reports explicitly remain in progress while local measurement gates are incomplete. Report generation never substitutes teammate measurements for missing Vivo results.
