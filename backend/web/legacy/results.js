import { $, list, action, download } from './client.js';

function svgNode(name, attributes, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  if (text !== undefined) element.textContent = text;
  return element;
}
function timeline(summary) {
  const bins = summary.timeline;
  const chart = svgNode('svg', { width: Math.max(330, bins.length * 7 + 30), height: 160, role: 'img', 'aria-label': 'Binder requests per second' });
  const sum = bin => bin.incoming + bin.outgoing + bin.internal, peak = Math.max(1, ...bins.map(sum));
  chart.append(svgNode('text', { x: 0, y: 14 }, 'Peak ' + peak));
  for (const bin of bins) {
    const height = 105 * sum(bin) / peak;
    const bar = svgNode('rect', { x: 16 + 7 * bin.second, y: 130 - height, width: 6, height, fill: '#126078' });
    bar.append(svgNode('title', {}, bin.second + 's: ' + sum(bin))); chart.append(bar);
  }
  for (const marker of summary.markers.filter(item => item.inside_trace)) {
    const position = 16 + 7 * marker.offset_seconds;
    const line = svgNode('line', { x1: position, x2: position, y1: 24, y2: 135, stroke: '#d05b00', 'stroke-width': 2 });
    line.append(svgNode('title', {}, marker.label + ' at ' + marker.offset_seconds.toFixed(2) + 's')); chart.append(line);
  }
  chart.append(svgNode('text', { x: 16, y: 153 }, '0s')); $('timeline').replaceChildren(chart);
}
function graph(edges) {
  const top = edges.slice(0, 12), sources = [...new Set(top.map(edge => edge.sender))], sinks = [...new Set(top.map(edge => edge.receiver))];
  const chart = svgNode('svg', { width: 810, height: Math.max(60, Math.max(sources.length, sinks.length) * 33 + 35), role: 'img', 'aria-label': 'Directed process interaction graph' });
  const definitions = svgNode('defs', {}), arrow = svgNode('marker', { id: 'arrow', markerWidth: 9, markerHeight: 9, refX: 8, refY: 4, orient: 'auto', markerUnits: 'userSpaceOnUse' });
  arrow.append(svgNode('path', { d: 'M0,0 L8,4 L0,8 Z', fill: '#126078' })); definitions.append(arrow); chart.append(definitions);
  const position = index => 48 + index * 33;
  for (const edge of top) {
    const line = svgNode('line', { x1: 290, x2: 510, y1: position(sources.indexOf(edge.sender)), y2: position(sinks.indexOf(edge.receiver)), stroke: '#126078', 'stroke-width': Math.min(7, 1 + Math.log2(edge.count)), 'marker-end': 'url(#arrow)' });
    line.append(svgNode('title', {}, edge.sender + ' → ' + edge.receiver + ': ' + edge.count)); chart.append(line);
  }
  for (const [names, horizontal, heading] of [[sources, 4, 'Sender'], [sinks, 520, 'Receiver']]) {
    chart.append(svgNode('text', { x: horizontal, y: 19, 'font-weight': 'bold' }, heading));
    names.forEach((name, index) => {
      const label = svgNode('text', { x: horizontal, y: position(index) + 5, 'font-size': 13 }, name.length > 40 ? name.slice(0, 39) + '…' : name);
      label.append(svgNode('title', {}, name)); chart.append(label);
    });
  }
  $('graph').replaceChildren(top.length ? chart : 'No observed edges.');
}
export function render(summary) {
  $('results').hidden = false;
  const format = value => value == null ? 'unavailable' : value.toFixed(2);
  $('metrics').textContent = summary.transaction_count + ' requests · ' + summary.peer_process_count + ' resolved peers · ' + (summary.direction_counts.outgoing || 0) + ' outgoing (' + format(summary.rates_per_second.outgoing) + '/s) · '
    + (summary.direction_counts.incoming || 0) + ' incoming (' + format(summary.rates_per_second.incoming) + '/s) · ' + summary.matched_sync_calls + ' matched synchronous calls · median ' + format(summary.sync_latency_ms.median) + ' ms · p95 ' + format(summary.sync_latency_ms.p95) + ' ms';
  list('warnings', summary.warnings, 'No trace quality warnings detected.');
  list('peers', summary.top_peers.map(([peer, count]) => peer + ': ' + count), 'No resolved peers.');
  list('interfaces', [...summary.interfaces.slice(0, 10).map(item => item.interface + '.' + item.method + ' · ' + item.direction + ' · ' + item.count), summary.unidentified_interface_count + ' requests with unidentified interfaces.'], '');
  list('paths', summary.candidate_paths.slice(0, 10).map(path => path.processes.join(' → ') + ' · ' + path.hops + ' hops · ' + path.evidence), 'No candidate paths found.');
  timeline(summary); graph(summary.edges);
}
export function renderExports(names, id) {
  $('exports').replaceChildren(...names.map(name => { const button = document.createElement('button'); button.textContent = name; button.onclick = action(() => download('runs/' + id + '/' + name, name)); return button; }));
}
export function renderResources(summary) {
  $('resource-results').hidden = false;
  $('resource-window').textContent = `${summary.mode}: ${summary.elapsed_seconds.toFixed(1)} seconds; ${summary.sample_count} samples; observer commands took ${summary.observer_wall_seconds.toFixed(1)} seconds in total.`;
  const labels = { system_cpu_reported_percent: 'System CPU (%)', agent_cpu_one_core_percent: 'Agent CPU (% of one core)', controller_cpu_one_core_percent: 'Controller CPU (% of one core)', agent_pss_kib: 'Agent PSS (KiB)', controller_pss_kib: 'Controller PSS (KiB)', system_used_kib: 'System used memory (KiB)' };
  const rows = Object.entries(summary.metrics).map(([key, value]) => [labels[key] || key, value.median, `${value.samples} samples${value.reason ? ': ' + value.reason : ''}`]);
  rows.push(['Charge used (µAh)', summary.battery.charge_used_uah, summary.battery.reason || 'Whole device'], ['Estimated energy (mWh)', summary.battery.estimated_energy_mwh, 'Charge × voltage estimate'], ['Estimated mean power (mW)', summary.battery.estimated_mean_power_mw, 'Whole device']);
  $('resource-metrics').replaceChildren(...rows.map(cells => { const row = document.createElement('tr'); for (const value of cells) { const cell = document.createElement('td'); cell.textContent = value == null ? 'Unavailable' : typeof value === 'number' ? value.toFixed(2) : value; row.append(cell); } return row; }));
  $('resource-issues').textContent = [...summary.issues, ...summary.cpu_rejection_reasons].join(' · ');
}
