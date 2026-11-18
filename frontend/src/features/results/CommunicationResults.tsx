import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Summary } from '../../types';
import { number } from '../../shared/format';

const CommunicationCharts = lazy(() =>
  import('../../CommunicationCharts').then((module) => ({
    default: module.CommunicationCharts,
  }))
);

export function CommunicationResults({ summary }: { summary: Summary }) {
  const { t } = useTranslation();
  const [windowed, setWindowed] = useState(false);
  const data = windowed && summary.task_window ? summary.task_window : summary;
  return (
    <div className="results">
      <h2>{t('results')}</h2>
      <div className="segmented">
        <button
          className={!windowed ? 'active' : ''}
          onClick={() => setWindowed(false)}
        >
          {t('wholeTrace')}
        </button>
        <button
          disabled={!summary.task_window}
          className={windowed ? 'active' : ''}
          onClick={() => setWindowed(true)}
        >
          {t('taskWindow')}
        </button>
      </div>
      {!summary.task_window && <p className="muted">{t('noTaskWindow')}</p>}
      <div className="metrics">
        <div>
          <small>{t('requests')}</small>
          <strong>{number(data.transaction_count)}</strong>
        </div>
        <div>
          <small>{t('peers')}</small>
          <strong>{number(data.peer_process_count)}</strong>
        </div>
        <div>
          <small>{t('duration')}</small>
          <strong>
            {number(data.trace_duration_seconds)}
            <em>s</em>
          </strong>
        </div>
      </div>
      <p>
        {t('incoming')} {number(data.direction_counts.incoming || 0)} ·{' '}
        {t('outgoing')} {number(data.direction_counts.outgoing || 0)} ·{' '}
        {t('internal')} {number(data.direction_counts.internal || 0)}
      </p>
      <p>
        {t('latency')}: {number(data.sync_latency_ms.median)} ms / p95{' '}
        {number(data.sync_latency_ms.p95)} ms
      </p>
      <Suspense fallback={<p className="muted">{t('chartLoading')}</p>}>
        <CommunicationCharts data={data} />
      </Suspense>
      <details>
        <summary>
          {t('details')} · {data.edges.length}
        </summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('sender')}</th>
                <th>{t('receiver')}</th>
                <th>{t('count')}</th>
              </tr>
            </thead>
            <tbody>
              {data.edges.map((edge, index) => (
                <tr key={index}>
                  <td className="mono">{edge.sender}</td>
                  <td className="mono">→ {edge.receiver}</td>
                  <td>{edge.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {summary.per_package && (
        <>
          <h3>{t('perPackage')}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('packages')}</th>
                  <th>{t('requests')}</th>
                  <th>{t('peers')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.per_package).map(([name, item]) => (
                  <tr key={name}>
                    <td className="mono">{name}</td>
                    <td>{item.transaction_count}</td>
                    <td>{item.peer_process_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <details>
        <summary>
          {t('interfaces')} · {data.interfaces.length}
        </summary>
        {data.interfaces.map((item, index) => (
          <p className="mono" key={index}>
            {item.interface}.{item.method} · {t(item.direction)} · {item.count}
          </p>
        ))}
      </details>
      <details>
        <summary>
          {t('paths')} · {data.candidate_paths.length}
        </summary>
        <p>{t('candidateHelp')}</p>
        {data.candidate_paths.slice(0, 30).map((path, index) => (
          <p className="mono" key={index}>
            {path.processes.join(' → ')}
          </p>
        ))}
      </details>
    </div>
  );
}
