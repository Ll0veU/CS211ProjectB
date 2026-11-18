import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { Run, Spec, Summary } from '../../types';
import { resource, terminal } from '../../shared/format';
import { Field } from '../../shared/ui';
import { CommunicationResults } from '../results/CommunicationResults';
import { ResourceResults } from '../results/ResourceResults';
import { GroundForm } from './GroundForm';
import { RunTimer } from './RunTimer';
import { useRunEvidence } from './useRunEvidence';

export function RunPanel({
  run,
  token,
  clock,
  spec,
  refresh,
  perform,
  working,
  reportError,
  exportFile,
}: {
  run: Run;
  token: string;
  clock: number;
  spec?: Spec;
  refresh: () => Promise<void>;
  perform: (work: () => Promise<void>) => Promise<void>;
  working: boolean;
  reportError: (failure: unknown) => void;
  exportFile: (path: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const { quality, files, summary, resources, reload } = useRunEvidence(
    run,
    token,
    reportError
  );
  const [reason, setReason] = useState('');
  const [reanalysis, setReanalysis] = useState<{
    id: string;
    summary: Summary;
  }>();
  const [probe, setProbe] = useState<Record<string, boolean>>();
  return (
    <section className="paper">
      <div className="eyebrow">
        {run.workload} / {t(run.mode)} / {t('rep')} {run.repetition}
      </div>
      <h1>{t(run.status)}</h1>
      <RunTimer run={run} clock={clock} />
      <div className="status-grid">
        {[
          [t('capture'), t(run.status)],
          [t('actualOutcome'), run.outcome ? t(run.outcome) : '—'],
          [
            t('protocolQuality'),
            quality?.protocol_valid ? t('passed') : t('incomplete'),
          ],
          [t('attribution'), t(quality?.attribution_status || 'unreviewed')],
          [t('eligible'), quality?.valid ? t('accepted') : t('incomplete')],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {run.error && (
        <details open>
          <summary>{t('technical')}</summary>
          {run.error}
        </details>
      )}
      {run.status === 'awaiting_controller' && (
        <div className="callout">
          <p>{t('armHelp')}</p>
          {window.ProjectB?.protocolVersion?.() === 2 ? (
            <button
              onClick={() =>
                window.ProjectB?.armRecording?.(run.id, run.workload, token)
              }
            >
              {t('arm')}
            </button>
          ) : (
            <p>{t('controller_update')}</p>
          )}
        </div>
      )}
      {!terminal(run) && (
        <button
          className="danger"
          disabled={working}
          onClick={() =>
            void perform(async () => {
              await api(`runs/${run.id}/stop`, token, {});
              await refresh();
            })
          }
        >
          {t('stop')}
        </button>
      )}
      {!resource(run.mode) && (
        <>
          <h2>{t('markers')}</h2>
          <p>{t('phoneOnly')}</p>
          <div className="marker-track">
            {(spec?.workloads[run.workload].markers || []).map((label) => {
              const events = run.markers.filter(
                (marker) => marker.label === label
              );
              return (
                <div key={label} className={events.length ? 'marked' : ''}>
                  <span>{events.length ? '✓' : '○'}</span>
                  <strong>{t(label)}</strong>
                  <small>{events.length ? t('saved') : t('pending')}</small>
                </div>
              );
            })}
          </div>
          <ul className="event-list">
            {run.markers.map((marker, index) => (
              <li key={marker.event_id || index}>
                <strong>{t(marker.label)}</strong>
                <code>{String(marker.boottime_ns)} ns</code>
                <small>{marker.source}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="divider" />
      <GroundForm
        run={run}
        token={token}
        saved={async () => {
          await refresh();
          await reload();
        }}
      />
      {quality && (
        <div className={`callout ${quality.valid ? 'positive' : ''}`}>
          <h3>{t('quality')}</h3>
          {quality.details.map((item, index) => (
            <div key={index}>
              <p>
                {t(item.code, {
                  ...item.params,
                  marker: item.params.marker
                    ? t(item.params.marker)
                    : undefined,
                })}
              </p>
              {item.code === 'technical_quality' && (
                <details>
                  <summary>{t('technical')}</summary>
                  {item.detail}
                </details>
              )}
            </div>
          ))}
          {!quality.details.length && <p>{t('passed')}</p>}
        </div>
      )}
      {summary && <CommunicationResults summary={summary} />}
      {resources && <ResourceResults result={resources} />}
      {terminal(run) &&
        run.target_package === 'com.google.android.apps.bard' && (
          <div className="callout">
            <p>{t('scopeHelp')}</p>
            <button
              className="secondary"
              disabled={working}
              onClick={() =>
                void perform(async () => {
                  setReanalysis(
                    await api(`runs/${run.id}/analyses`, token, {
                      target_packages: [
                        'com.google.android.apps.bard',
                        'com.google.android.googlequicksearchbox',
                      ],
                    })
                  );
                })
              }
            >
              {t('reanalyze')}
            </button>
            <p className="muted">{t('reanalysisHelp')}</p>
            {reanalysis && (
              <>
                <code>{reanalysis.id}</code>
                <CommunicationResults summary={reanalysis.summary} />
              </>
            )}
          </div>
        )}
      <h2>{t('downloads')}</h2>
      <div className="file-grid">
        {files.map((name) => (
          <button
            className="secondary mono"
            key={name}
            onClick={() => exportFile(`runs/${run.id}/${name}`, name)}
          >
            ↓ {name}
          </button>
        ))}
      </div>
      {terminal(run) && run.campaign_id && (
        <details>
          <summary>{t('retry')}</summary>
          <p>{t('retryHelp')}</p>
          <Field label={t('retryReason')}>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <button
            disabled={working || !reason.trim()}
            onClick={() =>
              void perform(async () => {
                await api(`campaigns/${run.campaign_id}/retry`, token, {
                  trial_id: run.trial_id,
                  reason,
                });
                await refresh();
              })
            }
          >
            {t('retry')}
          </button>
        </details>
      )}
      {resource(run.mode) && terminal(run) && (
        <div className="callout">
          <p>{t('capabilityHelp')}</p>
          <button
            className="secondary"
            onClick={() =>
              void perform(async () => {
                setProbe(
                  await api('devices/resource-capabilities', token, {
                    serial: run.serial,
                    package: run.target_package,
                  })
                );
              })
            }
          >
            {t('probe')}
          </button>
          {probe && (
            <p>
              {t('cpu')}: {t(probe.cpu_available ? 'available' : 'unavailable')}{' '}
              · {t('pss')}:{' '}
              {t(probe.agent_pss_available ? 'available' : 'unavailable')} ·{' '}
              {t('battery')}:{' '}
              {t(probe.charge_counter_available ? 'available' : 'unavailable')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
