import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { Quality, Run } from '../../types';
import { Field } from '../../shared/ui';

export function History({
  runs,
  choose,
  token,
}: {
  runs: Run[];
  choose: (id: string) => void;
  token: string;
}) {
  const { t } = useTranslation();
  const [workload, setWorkload] = useState('');
  const [version, setVersion] = useState('');
  const [repetition, setRepetition] = useState('');
  const [eligibility, setEligibility] = useState('');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let current = true;
    void Promise.all(
      runs.map(
        async (run) =>
          [
            run.id,
            (await api<Quality>(`runs/${run.id}/quality`, token)).valid,
          ] as const
      )
    )
      .then((values) => {
        if (current) setChecks(Object.fromEntries(values));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [runs, token]);
  const filtered = runs.filter(
    (run) =>
      (!workload || run.workload === workload) &&
      (!version || (run.protocol_version || 'legacy') === version) &&
      (!repetition || run.repetition === Number(repetition)) &&
      (!eligibility || checks[run.id] === (eligibility === 'yes'))
  );
  return (
    <section className="paper">
      <div className="eyebrow">02 / {t('history')}</div>
      <h1>{t('history')}</h1>
      <div className="form-grid">
        <Field label="Workload">
          <select
            value={workload}
            onChange={(event) => setWorkload(event.target.value)}
          >
            <option value="">{t('all')}</option>
            {['W0', 'W1', 'W2'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label={t('protocol')}>
          <select
            value={version}
            onChange={(event) => setVersion(event.target.value)}
          >
            <option value="">{t('all')}</option>
            {[
              ...new Set(runs.map((run) => run.protocol_version || 'legacy')),
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label={t('rep')}>
          <input
            type="number"
            min={1}
            value={repetition}
            onChange={(event) => setRepetition(event.target.value)}
          />
        </Field>
        <Field label={t('eligible')}>
          <select
            value={eligibility}
            onChange={(event) => setEligibility(event.target.value)}
          >
            <option value="">{t('all')}</option>
            <option value="yes">{t('accepted')}</option>
            <option value="no">{t('incomplete')}</option>
          </select>
        </Field>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {['run', 'capture', 'actualOutcome', 'eligible'].map((key) => (
                <th key={key}>{t(key)}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((run) => (
              <tr key={run.id}>
                <td>
                  <strong>
                    {run.workload} · {t(run.mode)}
                  </strong>
                  <small>
                    {t(run.phase || 'legacy')} · R{run.repetition} ·{' '}
                    {run.id.slice(0, 8)}
                  </small>
                </td>
                <td>{t(run.status)}</td>
                <td>{run.outcome ? t(run.outcome) : '—'}</td>
                <td>
                  {checks[run.id] === undefined
                    ? '…'
                    : t(checks[run.id] ? 'accepted' : 'incomplete')}
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => choose(run.id)}
                  >
                    {t('details')} →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
