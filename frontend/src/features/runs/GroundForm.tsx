import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { Ground, Run } from '../../types';
import { resource } from '../../shared/format';
import { Badge, Check, Field } from '../../shared/ui';

export function GroundForm({
  run,
  token,
  saved,
}: {
  run: Run;
  token: string;
  saved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const key = `projectb.ground.${run.id}`;
  const initial = (): Ground => ({
    outcome: run.outcome || '',
    browser_package: run.browser_package || '',
    recognized_text: run.recognized_text || '',
    actual_response: run.actual_response || '',
    notes: run.notes || '',
    actual_url: run.actual_url || '',
    deviations: run.deviations || '',
    conditions_confirmed: run.conditions_confirmed || false,
    page_verified: run.page_verified || false,
    idle_undisturbed: run.idle_undisturbed || false,
    recognized_text_available: run.recognized_text_available ?? false,
    confirmation_status: run.confirmation_status || 'unknown',
  });
  const [form, setForm] = useState<Ground>(() => {
    try {
      return (
        (JSON.parse(localStorage.getItem(key) || 'null') as Ground) || initial()
      );
    } catch {
      return initial();
    }
  });
  const [dirty, setDirty] = useState(() => !!localStorage.getItem(key));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const update = <Key extends keyof Ground>(field: Key, value: Ground[Key]) => {
    const next = { ...form, [field]: value };
    setForm(next);
    setDirty(true);
    setMessage('');
    localStorage.setItem(key, JSON.stringify(next));
  };
  // Server polling must not replace an operator's unsaved observations.
  useEffect(() => {
    if (!dirty) setForm(initial());
  }, [run]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    const snapshot = { ...form };
    try {
      await api(`runs/${run.id}/outcome`, token, snapshot);
      const verified = await api<Run>(`runs/${run.id}`, token);
      if (
        Object.keys(snapshot).some(
          (field) =>
            verified[field as keyof Ground] !== snapshot[field as keyof Ground]
        )
      )
        throw new Error('Backend readback differs from saved observations');
      localStorage.removeItem(key);
      setForm(snapshot);
      setDirty(false);
      setMessage('verified');
      await saved();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={(event) => void save(event)} className="ground-form">
      <h2>{t('ground')}</h2>
      <p>{t('groundHelp')}</p>
      {dirty && <Badge>{t('unsaved')}</Badge>}
      <fieldset disabled={saving}>
        <Field label={t('outcome')}>
          <select
            required
            value={form.outcome}
            onChange={(event) => update('outcome', event.target.value)}
          >
            <option value="">{t('selectOutcome')}</option>
            {['success', 'failure', 'timeout', 'unexpected_activity'].map(
              (value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              )
            )}
          </select>
        </Field>
        {!resource(run.mode) && run.workload === 'W1' && (
          <>
            <Field label={t('browser')}>
              <input
                value={form.browser_package}
                onChange={(event) =>
                  update('browser_package', event.target.value)
                }
              />
            </Field>
            <Field label={t('actualUrl')}>
              <input
                value={form.actual_url}
                onChange={(event) => update('actual_url', event.target.value)}
              />
            </Field>
            <Check
              label={t('pageVerified')}
              checked={form.page_verified}
              onChange={(value) => update('page_verified', value)}
            />
            <Field label={t('confirmations')}>
              <select
                value={form.confirmation_status}
                onChange={(event) =>
                  update('confirmation_status', event.target.value)
                }
              >
                {['unknown', 'none', 'recorded'].map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {!resource(run.mode) && run.workload === 'W2' && (
          <>
            <Check
              label={t('speechVisible')}
              checked={form.recognized_text_available}
              onChange={(value) => update('recognized_text_available', value)}
            />
            {form.recognized_text_available && (
              <Field label={t('recognized')}>
                <input
                  value={form.recognized_text}
                  onChange={(event) =>
                    update('recognized_text', event.target.value)
                  }
                />
              </Field>
            )}
            <Field label={t('response')}>
              <textarea
                value={form.actual_response}
                onChange={(event) =>
                  update('actual_response', event.target.value)
                }
              />
            </Field>
          </>
        )}
        {run.workload === 'W0' && (
          <Check
            label={t('idleConfirmed')}
            checked={form.idle_undisturbed}
            onChange={(value) => update('idle_undisturbed', value)}
          />
        )}
        <Field label={t('notes')}>
          <textarea
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
            maxLength={2000}
          />
        </Field>
        <Field label={t('deviations')}>
          <textarea
            value={form.deviations}
            onChange={(event) => update('deviations', event.target.value)}
            maxLength={2000}
          />
        </Field>
        <Check
          label={t('conditionsConfirmed')}
          checked={form.conditions_confirmed}
          onChange={(value) => update('conditions_confirmed', value)}
        />
        <button disabled={saving}>{t(saving ? 'saving' : 'save')}</button>
      </fieldset>
      {message && (
        <p role="status" className="success-message">
          {t(message)}
        </p>
      )}
      {error && (
        <div role="alert">
          {t('request_failed')}
          <details>
            <summary>{t('technical')}</summary>
            {error}
          </details>
        </div>
      )}
    </form>
  );
}
