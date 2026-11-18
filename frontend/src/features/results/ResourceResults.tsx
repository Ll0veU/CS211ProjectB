import { useTranslation } from 'react-i18next';
import type { ResourceSummary } from '../../types';
import { number } from '../../shared/format';

export function ResourceResults({ result }: { result: ResourceSummary }) {
  const { t } = useTranslation();
  const quality = result.sampling_quality;
  return (
    <>
      <h2>{t('resourceResults')}</h2>
      <p>{t('resourceHelp')}</p>
      <p className="mono">{result.observer || '—'}</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {['metric', 'median', 'peak', 'samples'].map((key) => (
                <th key={key}>{t(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(result.metrics).map(([name, value]) => (
              <tr key={name}>
                <td>
                  {t(name)}
                  {value.reason && (
                    <details>
                      <summary>{t('unavailable')}</summary>
                      {value.reason}
                    </details>
                  )}
                </td>
                <td>{number(value.median)}</td>
                <td>{number(value.peak)}</td>
                <td>{value.samples}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {[
        'charge_used_uah',
        'estimated_energy_mwh',
        'estimated_mean_power_mw',
      ].map((name) => (
        <p key={name}>
          {t(name)}: {number(result.battery[name] as number | null)}
        </p>
      ))}
      {result.battery.reason && (
        <details>
          <summary>{t('technical')}</summary>
          {result.battery.reason}
        </details>
      )}
      {quality && (
        <div className="callout">
          <h3>{t('samplingQuality')}</h3>
          <p>
            {t('snapshots')}: {quality.sample_count} · {t('cpuRejected')}:{' '}
            {quality.cpu_rejected_samples} · {t('commandErrors')}:{' '}
            {quality.raw_command_error_count}
          </p>
          <p>
            {t('temperature')}:{' '}
            {quality.temperature_c
              ? `${number(quality.temperature_c.min)}–${number(quality.temperature_c.max)} °C`
              : t('unavailable')}
          </p>
          <p>
            {t('batteryWindow')}: {number(quality.battery_window_seconds)} s ·{' '}
            {t('observerWall')}: {number(quality.observer_wall_seconds)} s
          </p>
          <p>{t('observerCaveat')}</p>
        </div>
      )}
      {result.per_package && (
        <details>
          <summary>{t('perPackage')}</summary>
          {Object.entries(result.per_package).map(([name, metrics]) => (
            <div key={name}>
              <code>{name}</code>
              {Object.entries(metrics).map(([metric, value]) => (
                <p key={metric}>
                  {t(metric)}: {number(value.median)} · n={value.samples}
                </p>
              ))}
            </div>
          ))}
        </details>
      )}
    </>
  );
}
