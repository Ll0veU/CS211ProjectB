import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { Campaign, Config, Spec } from '../../types';
import { Badge, Check, Field } from '../../shared/ui';

function defaults(): Config {
  return {
    device_label: 'vivox80',
    target_packages: [
      'com.google.android.apps.bard',
      'com.google.android.googlequicksearchbox',
    ],
    browser_package: 'com.android.chrome',
    account_label: '',
    gemini_mode: '',
    network: '',
    brightness: '',
    volume: '',
    read_aloud: '',
    resource_seconds: 300,
    scope: 'tasks_and_resources',
    agent_id: 'gemini',
  };
}
const fields: [keyof Config, string][] = [
  ['device_label', 'phoneLabel'],
  ['account_label', 'account'],
  ['gemini_mode', 'geminiMode'],
  ['network', 'network'],
  ['brightness', 'brightness'],
  ['volume', 'volume'],
  ['read_aloud', 'readAloud'],
  ['browser_package', 'browser'],
];

export function PlanEditor({
  token,
  spec,
  plan,
  working,
  perform,
  refresh,
  choosePlan,
  exportFile,
}: {
  token: string;
  spec?: Spec;
  plan?: Campaign;
  working: boolean;
  perform: (work: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  choosePlan: (id: string) => void;
  exportFile: (path: string, name: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(
    () => localStorage.getItem('projectb.planDraftName') || 'Gemini / Vivo X80'
  );
  const [config, setConfig] = useState<Config>(() => {
    try {
      return (
        (JSON.parse(
          localStorage.getItem('projectb.planDraft') || 'null'
        ) as Config) || defaults()
      );
    } catch {
      return defaults();
    }
  });
  const [scope, setScope] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [energy, setEnergy] = useState(false);
  const [revision, setRevision] = useState(false);
  useEffect(() => {
    localStorage.setItem('projectb.planDraft', JSON.stringify(config));
  }, [config]);
  useEffect(() => {
    localStorage.setItem('projectb.planDraftName', name);
  }, [name]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      const created = await api<Campaign>(
        revision && plan ? `campaigns/${plan.id}/revise` : 'campaigns',
        token,
        {
          name,
          config: {
            ...config,
            scope: config.scope || 'tasks_and_resources',
            agent_id: config.agent_id || 'gemini',
            target_packages: config.target_packages
              .map((value) => value.trim())
              .filter(Boolean),
          },
        }
      );
      await refresh();
      choosePlan(created.id);
      setRevision(false);
    });
  };
  const locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en';
  const taskOnly = config.scope === 'tasks_only';
  const selectedTaskOnly = plan?.config.scope === 'tasks_only';
  return (
    <>
      <section className="paper">
        <div className="eyebrow">02 / {t('plans')}</div>
        <h1>{revision ? t('newVersion') : t('newPlan')}</h1>
        <p className="lead">{t(taskOnly ? 'taskOnlyHelp' : 'createHelp')}</p>
        <form onSubmit={submit}>
          <Field label={t('planName')}>
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label={t('campaignScope')}>
            <select
              value={config.scope || 'tasks_and_resources'}
              onChange={(event) =>
                setConfig({
                  ...config,
                  scope: event.target.value as Config['scope'],
                })
              }
            >
              <option value="tasks_and_resources">
                {t('tasksAndResources')}
              </option>
              <option value="tasks_only">{t('tasksOnly')}</option>
            </select>
          </Field>
          <Field label={t('logicalAgent')}>
            <input
              required
              pattern="[a-z][a-z0-9_-]{1,60}"
              value={config.agent_id || 'gemini'}
              onChange={(event) =>
                setConfig({ ...config, agent_id: event.target.value })
              }
            />
          </Field>
          <div className="form-grid">
            {fields.map(([key, label]) => (
              <Field key={key} label={t(label)}>
                <input
                  required
                  maxLength={200}
                  value={String(config[key])}
                  onChange={(event) =>
                    setConfig({ ...config, [key]: event.target.value })
                  }
                />
              </Field>
            ))}
          </div>
          <Field label={t('packages')}>
            <textarea
              required
              rows={2}
              value={config.target_packages.join('\n')}
              onChange={(event) =>
                setConfig({
                  ...config,
                  target_packages: event.target.value.split('\n'),
                })
              }
            />
          </Field>
          <p className="muted">{t('scopeHelp')}</p>
          {!taskOnly && (
            <Field label={t('window')}>
              <select
                value={config.resource_seconds}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    resource_seconds: Number(event.target.value),
                  })
                }
              >
                <option value={300}>300 {t('seconds')}</option>
                <option value={540}>540 {t('seconds')}</option>
              </select>
            </Field>
          )}
          <button disabled={working || !token}>
            {t(revision ? 'revise' : 'create')}
          </button>
        </form>
      </section>
      {plan && (
        <section className="paper">
          <h2>
            {plan.name}{' '}
            <Badge good={plan.state === 'frozen'}>{t(plan.state)}</Badge>
          </h2>
          <p className="mono">{plan.id}</p>
          <dl className="condition-list">
            {fields.map(([key, label]) => (
              <div key={key}>
                <dt>{t(label)}</dt>
                <dd>{String(plan.config[key])}</dd>
              </div>
            ))}
          </dl>
          <p>{t('protocolChange')}</p>
          <div className="button-row">
            <button
              className="secondary"
              onClick={() => {
                setRevision(true);
                setConfig(plan.config);
                setName(plan.name + ' / revision');
              }}
            >
              {t('revise')}
            </button>
            <button
              className="secondary"
              onClick={() =>
                exportFile(
                  `campaigns/${plan.id}/export.json`,
                  'experiment-plan.json'
                )
              }
            >
              {t('exportJson')}
            </button>
            <button
              className="secondary"
              onClick={() =>
                exportFile(
                  `campaigns/${plan.id}/export.csv`,
                  'trial-records.csv'
                )
              }
            >
              {t('exportCsv')}
            </button>
          </div>
          {plan.state === 'draft' && (
            <div className="callout">
              <h3>{t('freeze')}</h3>
              <Check
                label={t('scopeConfirm')}
                checked={scope}
                onChange={setScope}
              />
              <Check
                label={t(
                  selectedTaskOnly ? 'taskPilotConfirm' : 'pilotConfirm'
                )}
                checked={reviewed}
                onChange={setReviewed}
              />
              {!selectedTaskOnly && (
                <Check
                  label={t('energyConfirm')}
                  checked={energy}
                  onChange={setEnergy}
                />
              )}
              <button
                disabled={working || !scope || !reviewed}
                onClick={() =>
                  void perform(async () => {
                    await api(`campaigns/${plan.id}/freeze`, token, {
                      scope_confirmed: scope,
                      pilot_reviewed: reviewed,
                      energy_unresolved_ack: energy,
                    });
                    await refresh();
                  })
                }
              >
                {t('freeze')}
              </button>
            </div>
          )}
          <h3>{t('guide')}</h3>
          <div className="button-row">
            <button
              className="secondary"
              onClick={() =>
                exportFile(`campaigns/${plan.id}/guide.en.md`, 'guide.en.md')
              }
            >
              ↓ English
            </button>
            <button
              className="secondary"
              onClick={() =>
                exportFile(
                  `campaigns/${plan.id}/guide.zh-CN.md`,
                  'guide.zh-CN.md'
                )
              }
            >
              ↓ 简体中文
            </button>
          </div>
          <ol className="guide-list">
            {plan.protocol.checklist[locale].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
          {Object.entries(plan.protocol.workloads).map(
            ([workload, definition]) => (
              <div key={workload} className="callout">
                <h3>{workload}</h3>
                <p>{definition.instructions[locale]}</p>
                <p className="mono">{definition.sequence.join(' → ')}</p>
              </div>
            )
          )}
        </section>
      )}
      {!spec && <p className="muted">{t('connectionHelp')}</p>}
    </>
  );
}
