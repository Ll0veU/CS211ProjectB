import { $, native, state, terminal, api, action, select, list, floatingStatus } from './legacy/client.js';
import { packagePicker } from './legacy/packages.js';
import { render, renderExports, renderResources } from './legacy/results.js';
import { bindEvaluation } from './legacy/evaluation.js';

let active = state.get('run') || '', renderedRun = '', groundRun = '', browserPackageEdited = false;
let availableRuns = [], polling = false;
const picker = packagePicker();
const fields = ['outcome', 'notes', 'browser_package', 'recognized_text', 'actual_response'];
const descriptions = {
  W0: 'Open the Agent, wait for it to stabilize, then leave it untouched for 30 seconds.',
  W1: 'Submit: Open https://www.wikipedia.org in my phone’s browser. Record confirmations and the outcome.',
  W2: 'Use voice input to speak the W1 prompt. Mark voice start/end and response completion.',
};
function isResourceMode() { return $('mode').value.startsWith('resource_'); }
function workloadChanged() {
  $('seconds').value = isResourceMode() ? 300 : $('workload').value === 'W0' ? 40 : 90;
  $('instructions').textContent = descriptions[$('workload').value];
}
function modeChanged() {
  const resource = isResourceMode();
  $('resource-setup').hidden = !resource; $('seconds').min = resource ? 30 : 5; $('seconds').max = resource ? 540 : 180;
  $('device_label').required = resource; $('conditions').required = resource;
  $('controller_stop_ack').required = $('mode').value === 'resource_agent';
  $('capture-help').textContent = resource ? 'Fixed resource window after the preparation delay. Start with 300 seconds. Do not stop early or reopen the controller in arm A. Use longer windows if the battery counter cannot resolve a change.'
    : 'Capture includes app switching. W0 needs 30 untouched seconds; stop W1/W2 at completion or 60 seconds after the task begins.';
  workloadChanged();
}
function choose(id) {
  active = id; state.set('run', id); renderedRun = '';
  $('results').hidden = true; $('resource-results').hidden = true; $('exports').replaceChildren(); $('quality').textContent = '';
}
async function connect() {
  state.set('token', $('token').value.trim());
  const old = $('device').value;
  await refresh(true);
  try {
    const devices = await api('devices');
    select('device', devices.map(id => [id, id]), devices.includes(old) ? old : devices[0] || '', 'Select a device');
    if (old !== $('device').value) picker.clearPackages();
    $('message').textContent = devices.length ? 'Connected.' : 'Connected. No authorized ADB devices.';
  } catch (error) { $('message').textContent = 'Backend connected. ADB: ' + error.message; }
}
async function refresh(force = false) {
  floatingStatus(); if (polling && !force) return; polling = true;
  try {
    const runs = await api('runs'), busy = runs.find(run => !terminal.has(run.status));
    if (native) native.recording(busy?.status === 'recording' && !busy.mode?.startsWith('resource_') ? busy.id : '', busy?.workload || '', $('token').value.trim(), busy?.duration_seconds || 0);
    if (!active && busy) choose(busy.id);
    if (JSON.stringify(runs.map(run => run.id)) !== JSON.stringify(availableRuns)) {
      availableRuns = runs.map(run => run.id);
      select('history', runs.map(run => [run.id, (run.mode || 'trace') + ' · ' + run.workload + ' · ' + run.target_package + ' · ' + new Date(run.created_at).toLocaleString()]), active, 'Select a run');
    }
    $('history').value = active;
    const run = runs.find(item => item.id === active);
    $('start').disabled = Boolean(busy); $('stop').disabled = !['preparing', 'settling', 'recording'].includes(run?.status);
    $('add-marker').disabled = run?.status !== 'recording' || run.mode?.startsWith('resource_'); $('ground').hidden = !run;
    $('status').textContent = run ? (run.mode === 'baseline' ? 'Baseline (no Perfetto) · ' : '') + run.status + (run.error ? ' · ' + run.failed_stage + ': ' + run.error : '') : '';
    if (run?.status === 'settling' && run.settling_until) $('status').textContent += ` · switch to the Agent; measurement starts in about ${Math.max(0, Math.ceil(run.settling_until - Date.now() / 1000))} seconds`;
    else if (run?.status === 'recording' && run.resource_started_at) $('status').textContent += ` · about ${Math.max(0, Math.ceil(run.resource_started_at + run.duration_seconds - Date.now() / 1000))} seconds left in the resource window`;
    list('markers', run?.markers.map(marker => marker.label) || [], 'No markers recorded.');
    if (run && groundRun !== run.id) { fields.forEach(key => { $(key).value = run[key] || ''; }); groundRun = run.id; browserPackageEdited = false; }
    if (run && !browserPackageEdited && $('browser_package').value !== (run.browser_package || '')) { $('browser_package').value = run.browser_package || ''; renderedRun = ''; }
    const detection = run?.browser_detection;
    $('browser-detection').textContent = detection?.status === 'pending' ? 'Checking the foreground browser…' : detection?.status === 'detected' ? 'Detected browser: ' + detection.package + '. Confirm the webpage actually appeared; any manual entry is preserved.' : detection?.reason || 'Browser detection runs when a browser_launched marker is saved.';
    if (run && terminal.has(run.status) && renderedRun !== run.id) {
      const names = await api('runs/' + run.id + '/artifacts'), quality = await api('runs/' + run.id + '/quality');
      const summary = names.includes('summary.json') ? await api('runs/' + run.id + '/summary.json') : null;
      const resourceSummary = names.includes('resources_summary.json') ? await api('runs/' + run.id + '/resources_summary.json') : null;
      if (active === run.id) {
        if (summary) render(summary); if (resourceSummary) renderResources(resourceSummary); renderExports(names, run.id);
        $('quality').textContent = quality.valid ? 'Ground truth and available trace checks passed.' : quality.issues.join(' · '); renderedRun = run.id;
      }
    }
  } finally { polling = false; }
}
$('floating-settings').onclick = () => { if (native) native.floatingMarkerSettings(); };
floatingStatus(); workloadChanged(); bindEvaluation();
$('mode').onchange = modeChanged; $('workload').onchange = workloadChanged;
$('token').value = state.get('token') || '';
for (const key of ['device_label', 'conditions']) $(key).value = state.get(key) || '';
$('connect').onclick = action(connect);
$('resource-probe').onclick = action(async () => {
  $('resource-capabilities').textContent = 'Checking the selected phone; this may take several seconds…';
  try {
    const result = await api('devices/resource-capabilities', { serial: $('device').value, package: $('package').value.trim() });
    const flag = value => value ? 'available' : 'unavailable';
    $('resource-capabilities').textContent = `CPU: ${flag(result.cpu_available)}; Agent PSS: ${flag(result.agent_pss_available)}; system memory: ${flag(result.system_memory_available)}; charge counter: ${flag(result.charge_counter_available)}. ${result.note}`;
  } catch (error) { $('resource-capabilities').textContent = error.message; }
});
$('setup').onsubmit = action(async () => {
  if (native && isResourceMode()) throw Error('Start all three resource arms from the laptop browser, then switch to the Agent on the phone.');
  for (const key of ['device_label', 'conditions']) state.set(key, $(key).value.trim());
  const run = await api('runs', { serial: $('device').value, target_package: $('package').value.trim(), workload: $('workload').value,
    duration_seconds: Number($('seconds').value), repetition: Number($('repetition').value), mode: $('mode').value,
    device_label: $('device_label').value.trim(), conditions: $('conditions').value.trim(), sample_interval_seconds: Number($('sample_interval_seconds').value),
    settle_seconds: Number($('settle_seconds').value), controller_stop_ack: $('controller_stop_ack').checked });
  choose(run.id); await refresh(true);
});
$('history').onchange = action(async () => { choose($('history').value); await refresh(true); });
$('marker-form').onsubmit = action(async () => {
  const body = { label: $('marker').value }; if (native) body.boottime_ns = native.boottimeNs();
  await api('runs/' + active + '/markers', body); $('marker').value = ''; await refresh(true);
});
$('stop').onclick = action(async () => { await api('runs/' + active + '/stop', {}); $('stop').disabled = true; await refresh(true); });
$('browser_package').addEventListener('input', () => { browserPackageEdited = true; });
$('ground').onsubmit = action(async () => {
  await api('runs/' + active + '/outcome', Object.fromEntries(fields.map(key => [key, $(key).value])));
  $('message').textContent = 'Ground truth saved.'; browserPackageEdited = false; renderedRun = ''; await refresh(true);
});
if ($('token').value) action(connect)();
setInterval(() => { if ($('token').value) refresh().catch(error => { $('message').textContent = error.message; }); }, 1800);
