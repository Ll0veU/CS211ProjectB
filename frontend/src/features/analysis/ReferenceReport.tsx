import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReportReference } from '../../types';
import { number } from '../../shared/format';

export function ReferenceReport({ reference }: { reference: ReportReference }) {
  const { t } = useTranslation();
  const [differences, setDifferences] = useState(false);
  const metrics = reference.runs[0]
    ? Object.keys(reference.runs[0].metrics)
    : [];
  if (!reference.available)
    return <div className="callout">{t('referenceMissing')}</div>;
  return (
    <section className="reference-report">
      <h2>{t('referenceTitle')}</h2>
      <p>
        {reference.platform} · {reference.period} ·{' '}
        <code>{reference.observer}</code>
      </p>
      <div className="callout">
        <strong>{t('referenceBoundary')}</strong>
        <p>{t('referenceCaveat')}</p>
        <p>{t('referenceRound3')}</p>
        <p>{t('referenceNoMore')}</p>
      </div>
      <div className="segmented">
        <button
          className={!differences ? 'active' : ''}
          onClick={() => setDifferences(false)}
        >
          {t('runMetrics')}
        </button>
        <button
          className={differences ? 'active' : ''}
          onClick={() => setDifferences(true)}
        >
          {t('signedDifferences')}
        </button>
      </div>
      {differences && <p>{t('cpuDifferenceUnits')}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('rep')}</th>
              <th>{t('run')}</th>
              {metrics.map((metric) => (
                <th key={metric}>
                  {differences && metric.includes('cpu')
                    ? t(`${metric}_delta`)
                    : t(metric)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!differences
              ? reference.runs.map((row) => (
                  <tr key={row.short_id}>
                    <td>{row.repetition}</td>
                    <td>
                      {row.arm}
                      <small>
                        {row.short_id} · {row.local_start}
                      </small>
                    </td>
                    {metrics.map((metric) => (
                      <td key={metric}>{number(row.metrics[metric])}</td>
                    ))}
                  </tr>
                ))
              : reference.differences.map((row, index) => (
                  <tr key={index}>
                    <td>
                      {row.repetition === 'median'
                        ? t('median')
                        : row.repetition}
                    </td>
                    <td>{row.comparison}</td>
                    {metrics.map((metric) => (
                      <td key={metric}>{number(row.metrics[metric])}</td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>{t('samplingQuality')}</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  'rep',
                  'snapshots',
                  'validIntervals',
                  'cpuRejected',
                  'commandErrors',
                  'temperature',
                  'batteryWindow',
                  'observerWall',
                  'traceBytes',
                ].map((key) => (
                  <th key={key}>{t(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reference.quality.map((row) => (
                <tr key={row.trial}>
                  <td>{row.trial}</td>
                  <td>{row.snapshots}</td>
                  <td>{row.valid_cpu_intervals}</td>
                  <td>{row.cpu_rejected}</td>
                  <td>{row.raw_command_errors}</td>
                  <td>{row.temperature_c} °C</td>
                  <td>{number(row.battery_window_seconds)} s</td>
                  <td>{number(row.observer_wall_seconds)} s</td>
                  <td>{number(row.trace_bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details>
        <summary>{t('provenance')}</summary>
        <p className="mono">
          {reference.source} · SHA-256 {reference.sha256}
        </p>
        {reference.limitations?.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </details>
    </section>
  );
}
