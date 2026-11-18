import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { Evaluation, ReportReference } from '../../types';
import { number } from '../../shared/format';
import { ReferenceReport } from './ReferenceReport';

export function Comparison({
  token,
  perform,
  exportFile,
}: {
  token: string;
  perform: (work: () => Promise<void>) => Promise<void>;
  exportFile: (path: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<Evaluation>();
  const [reference, setReference] = useState<ReportReference>();
  return (
    <section className="paper">
      <div className="eyebrow">02 / {t('analysis')}</div>
      <h1>{t('analysis')}</h1>
      <p>{t('compareHelp')}</p>
      <div className="button-row">
        <button
          onClick={() =>
            void perform(async () =>
              setData(await api<Evaluation>('evaluation.json', token))
            )
          }
        >
          {t('refresh')}
        </button>
        <button
          className="secondary"
          onClick={() => exportFile('evaluation.json', 'evaluation.json')}
        >
          ↓ evaluation.json
        </button>
      </div>
      <div className="callout">
        <h3>{t('vivoDeliverables')}</h3>
        <p>{t('vivoStudyScope')}</p>
        <div className="button-row">
          <button
            className="secondary"
            disabled={!!window.ProjectB}
            onClick={() =>
              exportFile('study/bundle.zip', 'vivo-study-evidence.zip')
            }
          >
            {t('exportStudyBundle')}
          </button>
          <button
            className="secondary"
            disabled={!!window.ProjectB}
            onClick={() =>
              exportFile('study/report.zh-CN.md', 'vivo-report.zh-CN.md')
            }
          >
            {t('exportStudyReportZh')}
          </button>
          <button
            className="secondary"
            disabled={!!window.ProjectB}
            onClick={() =>
              exportFile('study/report.en.md', 'vivo-report.en.md')
            }
          >
            {t('exportStudyReportEn')}
          </button>
        </div>
        <p className="muted">{t('reportPendingBoundary')}</p>
      </div>
      <button
        className="secondary"
        onClick={() =>
          void perform(async () =>
            setReference(await api<ReportReference>('reference-report', token))
          )
        }
      >
        {t('loadReference')}
      </button>
      {reference && <ReferenceReport reference={reference} />}
      {!data?.classification_available && (
        <div className="callout">{t('classifierUnavailable')}</div>
      )}
      {data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {['run', 'actualOutcome', 'requests', 'peers'].map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.run_comparisons.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.workload} · R{item.repetition}
                      <small>
                        {t(item.phase || 'legacy')} · {item.id.slice(0, 8)}
                      </small>
                    </td>
                    <td>{item.outcome ? t(item.outcome) : '—'}</td>
                    <td>{number(item.metrics?.transaction_count)}</td>
                    <td>{number(item.metrics?.peer_process_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.descriptive_groups.map((group, index) => (
            <div key={index}>
              <h3>
                {group.agent} · {group.workload} · n=
                {group.valid_successful_runs}
              </h3>
              <table>
                <thead>
                  <tr>
                    {['metric', 'median', 'range'].map((key) => (
                      <th key={key}>{t(key)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(group.features).map(([name, value]) => (
                    <tr key={name}>
                      <td>{t(name)}</td>
                      <td>{number(value.median)}</td>
                      <td>
                        {number(value.min)}–{number(value.max)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {data.resource_overhead.triplets.map((triplet, index) => (
            <div key={index}>
              <h3>
                {t('rep')} {triplet.repetition}
              </h3>
              <p className="mono">{triplet.observer}</p>
              {triplet.comparability && (
                <div className="callout">
                  <p>
                    {t('pairGap')}:{' '}
                    {number(triplet.comparability.start_gap_seconds)} s ·{' '}
                    {t('pairTemperature')}:{' '}
                    {number(triplet.comparability.temperature_span_c)} °C
                  </p>
                  {triplet.comparability.warnings.map((code) => (
                    <p key={code}>{t(code)}</p>
                  ))}
                </div>
              )}
              {Object.entries(triplet.differences).map(([kind, metrics]) => (
                <div key={kind}>
                  <h4>{t(kind)}</h4>
                  <table>
                    <thead>
                      <tr>
                        {['metric', 'delta', 'relative'].map((key) => (
                          <th key={key}>{t(key)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(metrics).map(([name, value]) => (
                        <tr key={name}>
                          <td>{t(name)}</td>
                          <td>{number(value.delta)}</td>
                          <td>
                            {value.relative_percent == null
                              ? '—'
                              : `${number(value.relative_percent)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
          <details>
            <summary>
              {t('exclusions')} · {data.excluded_runs.length}
            </summary>
            {data.excluded_runs.map((item, index) => (
              <p key={index}>
                <code>{item.id.slice(0, 8)}</code> · {item.reason}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
