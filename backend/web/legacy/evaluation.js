import { $, api, action, download } from './client.js';

export function bindEvaluation() {
  $('evaluate').onclick = action(async () => {
    const result = await api('evaluation.json');
    const percent = value => value == null ? 'unavailable' : (100 * value).toFixed(1) + '%';
    const lines = [result.protocol_has_at_least_two_agents_with_three_repetitions ? 'Workload matrix complete.' : 'Workload matrix incomplete.',
      'Classifier coverage: ' + percent(result.classification_coverage) + '; accuracy on classified successful tasks: ' + percent(result.accuracy_when_classified),
      ...result.coverage.map(group => `${group.device} / ${group.conditions} / ${group.agent} / ${group.workload}: ${group.distinct_repetitions} valid repetitions, ${group.successful_runs} successes`),
      'Excluded classifier runs: ' + result.excluded_runs.length, 'Paired overhead trials: ' + result.overhead.pairs.length,
      ...result.overhead.groups.map(group => `${group.agent} / ${group.workload}: ${group.pair_count} pairs, median task time change ${group.median_delta_seconds.toFixed(2)}s (${group.median_relative_change_percent.toFixed(1)}%)`),
      'Overhead measures incremental tracing impact with the controller enabled; operator and network variation remain.',
      'Download evaluation JSON for per-run evidence, outcomes, uncertain predictions and exclusions.'];
    if (result.resource_overhead) {
      lines.push(`Resource comparisons: ${result.resource_overhead.triplets.length} complete triplets; ${result.resource_overhead.excluded.length} exclusions.`);
      for (const group of result.resource_overhead.groups) {
        lines.push(`${group.device} / ${group.agent} / ${group.workload}: ${group.triplet_count} triplets (${group.three_repetitions_complete ? '3 repetitions reached' : 'more repetitions needed'})`);
        for (const kind of ['controller', 'tracing', 'total']) {
          const metrics = group.metrics[kind];
          const value = (key, unit) => metrics[key].median_delta == null ? 'unavailable' : metrics[key].median_delta.toFixed(2) + unit + ` (n=${metrics[key].valid_triplets})`;
          lines.push(`${kind}: system CPU Δ ${value('system_cpu_reported_percent', ' percentage points')}; system memory Δ ${value('system_used_kib', ' KiB')}; estimated power Δ ${value('estimated_mean_power_mw', ' mW')}`);
        }
      }
      lines.push('All resource arms include the ADB observer. Negative differences are retained; unavailable readings are not zero.');
    }
    $('evaluation').textContent = lines.join('\n');
  });
  $('evaluation-export').onclick = action(() => download('evaluation.json', 'evaluation.json'));
}
