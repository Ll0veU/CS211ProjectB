import {
  useCallback,
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type FormEvent,
  type ReactNode,
} from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError, download } from './api';
import { LanguageSwitcher } from './LanguageSwitcher';
const CommunicationCharts = lazy(() =>
  import('./CommunicationCharts').then((module) => ({
    default: module.CommunicationCharts,
  }))
);
import type {
  Campaign,
  Config,
  Evaluation,
  Ground,
  Locale,
  Quality,
  ReportReference,
  ResourceSummary,
  Run,
  Spec,
  Summary,
  Trial,
} from './types';

const terminal = (run?: Run) =>
  !!run && ['complete', 'failed'].includes(run.status);
const resource = (mode?: string) => mode?.startsWith('resource_') ?? false;
const storage = {
  get: (key: string) =>
    localStorage.getItem(`projectb.${key}`) ||
    window.ProjectB?.loadState(key) ||
    '',
  set: (key: string, value: string) => {
    localStorage.setItem(`projectb.${key}`, value);
    window.ProjectB?.saveState(key, value);
  },
};
const number = (value: number | null | undefined) =>
  value == null
    ? '—'
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 });

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
function Badge({
  children,
  good = false,
}: {
  children: ReactNode;
  good?: boolean;
}) {
  return <span className={`badge ${good ? 'good' : ''}`}>{children}</span>;
}

export default function App() {
  const header = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!header.current) return;
    // Keep scrolling targets and sticky sidebars below the responsive header.
    const observer = new ResizeObserver((entries) => {
      document.documentElement.style.setProperty(
        '--header-height',
        `${entries[0].target.getBoundingClientRect().height}px`
      );
    });
    observer.observe(header.current);
    return () => observer.disconnect();
  }, []);
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [token, setToken] = useState(
    () =>
      sessionStorage.getItem('projectb.token') ||
      window.ProjectB?.loadState('token') ||
      ''
  );
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<string[]>([]);
  const [device, setDevice] = useState(() => storage.get('device'));
  const [runs, setRuns] = useState<Run[]>([]);
  const [plans, setPlans] = useState<Campaign[]>([]);
  const [spec, setSpec] = useState<Spec>();
  const [campaignId, setCampaignId] = useState(() => storage.get('campaign'));
  const [runId, setRunId] = useState(() => storage.get('run'));
  const [error, setError] = useState<{ code: string; detail: string }>();
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const pendingRequest = useRef(false);
  const mounted = useRef(true);
  const plan = plans.find((item) => item.id === campaignId);
  const selectedRun = runs.find((item) => item.id === runId);
  const busyRun = runs.find((item) => !terminal(item));
  const nextTrial = plan?.trials.find(
    (item) => !item.superseded && !item.run_ids.length
  );
  const locale: Locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en';

  const reportError = useCallback((failure: unknown) => {
    setError(
      failure instanceof ApiError
        ? { code: failure.code, detail: failure.detail }
        : { code: 'request_failed', detail: String(failure) }
    );
  }, []);
  const refresh = useCallback(async () => {
    if (pendingRequest.current || !token) return;
    pendingRequest.current = true;
    try {
      const [records, campaigns] = await Promise.all([
        api<Run[]>('runs', token),
        api<Campaign[]>('campaigns', token),
      ]);
      if (!mounted.current) return;
      setRuns(records);
      setPlans(campaigns);
      setConnected(true);
      const active = records.find((item) => !terminal(item));
      if (!runId && (active || records[0])) {
        setRunId((active || records[0]).id);
        storage.set('run', (active || records[0]).id);
      }
    } catch (failure) {
      setConnected(false);
      reportError(failure);
    } finally {
      pendingRequest.current = false;
    }
  }, [token, runId, reportError]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!token) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh, token]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    window.ProjectB?.setLocale?.(locale);
    storage.set('locale', locale);
  }, [locale]);
  const perform = async (work: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    setError(undefined);
    setNotice('');
    try {
      await work();
    } catch (failure) {
      reportError(failure);
    } finally {
      setWorking(false);
    }
  };
  const connect = () =>
    perform(async () => {
      sessionStorage.setItem('projectb.token', token);
      window.ProjectB?.saveState('token', token);
      const [found, definition] = await Promise.all([
        api<string[]>('devices', token),
        api<Spec>('protocol', token),
      ]);
      setDevices(found);
      setSpec(definition);
      if (!found.includes(device)) {
        setDevice(found[0] || '');
        storage.set('device', found[0] || '');
      }
      await refresh();
      setNotice('connected');
    });
  useEffect(() => {
    if (token && !spec && connected)
      void api<Spec>('protocol', token).then(setSpec).catch(reportError);
  }, [token, spec, connected, reportError]);
  const choosePlan = (value: string) => {
    setCampaignId(value);
    storage.set('campaign', value);
  };
  const chooseRun = (value: string) => {
    setRunId(value);
    storage.set('run', value);
    navigate('/current');
  };
  const startTrial = (preflight: boolean, ack: boolean) =>
    perform(async () => {
      if (!plan || !nextTrial) return;
      const run = await api<Run>('runs', token, {
        campaign_id: plan.id,
        trial_id: nextTrial.id,
        serial: device,
        preflight_confirmed: preflight,
        controller_stop_ack: ack,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      chooseRun(run.id);
      await refresh();
    });
  const exportFile = (path: string, name: string) =>
    void perform(() => download(path, token, name));
  const nav = [
    ['connect', '/'],
    ['plans', '/plans'],
    ['current', '/current'],
    ['history', '/history'],
    ['analysis', '/analysis'],
  ];

  return (
    <div className="app-shell">
      <div className="sticky-header" ref={header}>
        <header className="topbar">
          <NavLink to="/" className="wordmark">
            <span className="brand-icon">B</span>
            <span>
              <small>{t('brand')}</small>
              <strong>{t('title')}</strong>
            </span>
          </NavLink>
          <div className="top-actions">
            <Badge good={connected}>
              {connected ? t('connected') : t('disconnected')}
            </Badge>
            <LanguageSwitcher />
          </div>
        </header>
        <nav className="navigation">
          {nav.map(([label, path]) => (
            <NavLink key={path} to={path} end>
              {t(label)}
            </NavLink>
          ))}
        </nav>
        <div className="context-strip">
          <span>
            <small>{t('device')}</small>
            {device || '—'}
          </span>
          <span>
            <small>{t('agent')}</small>
            {plan
              ? `${plan.config.agent_id || 'gemini'} · ${plan.config.target_packages.length}`
              : selectedRun?.agent_id || '—'}
          </span>
          <span>
            <small>{t('protocol')}</small>
            {plan?.protocol_version || selectedRun?.protocol_version || '—'}
          </span>
          <span>
            <small>{t('capture')}</small>
            {busyRun ? t(busyRun.status) : '—'}
          </span>
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          <strong>{t(error.code)}</strong>
          <details>
            <summary>{t('technical')}</summary>
            {error.detail}
          </details>
        </div>
      )}
      {notice && (
        <div className="alert" role="status">
          {t(notice)}
        </div>
      )}
      <div className="workspace">
        <aside className="queue-panel">
          <div className="eyebrow">01 / {t('queue')}</div>
          <select
            aria-label={t('plans')}
            value={campaignId}
            onChange={(event) => choosePlan(event.target.value)}
          >
            <option value="">{t('noPlan')}</option>
            {plans.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {t(item.state)}
              </option>
            ))}
          </select>
          <div className="queue-list">
            {plan?.trials
              .filter((item) => !item.superseded)
              .map((trial, index) => (
                <button
                  key={trial.id}
                  className={`queue-item ${trial.run_ids.includes(runId) ? 'selected' : ''}`}
                  onClick={() =>
                    trial.run_ids.length
                      ? chooseRun(trial.run_ids.at(-1)!)
                      : navigate('/current')
                  }
                >
                  <span className="queue-number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <strong>
                      {resource(trial.mode) ? t(trial.mode) : trial.workload}
                    </strong>
                    <small>
                      {t(trial.phase)} · {t('rep')} {trial.repetition} ·{' '}
                      {t('attempt')} {trial.attempt}
                    </small>
                  </span>
                  <span
                    className={`queue-dot ${trial.run_ids.length ? 'done' : ''}`}
                  />
                </button>
              ))}
          </div>
          {!plan && <p className="muted">{t('noPlan')}</p>}
          <button className="secondary full" onClick={() => navigate('/plans')}>
            ＋ {t('newPlan')}
          </button>
          <p className="aside-note">{t('observation')}</p>
        </aside>
        <main>
          <Routes>
            <Route
              path="/"
              element={
                <section className="paper">
                  <div className="eyebrow">02 / {t('connect')}</div>
                  <h1>{t('subtitle')}</h1>
                  <p className="lead">{t('connectionHelp')}</p>
                  <div className="form-grid">
                    <Field label={t('token')}>
                      <input
                        type="password"
                        autoComplete="off"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                      />
                    </Field>
                    <Field label={t('device')}>
                      <select
                        value={device}
                        onChange={(event) => {
                          setDevice(event.target.value);
                          storage.set('device', event.target.value);
                        }}
                      >
                        <option value="">{t('noDevice')}</option>
                        {devices.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <button
                    disabled={working || !token}
                    onClick={() => void connect()}
                  >
                    {t('connectAction')}
                  </button>
                  <p>{t('deviceHelp')}</p>
                  <div className="divider" />
                  <h2>{t('phone')}</h2>
                  <p>{t('phoneHelp')}</p>
                  <Badge>{window.ProjectB ? t('phone') : t('desktop')}</Badge>
                  {window.ProjectB && (
                    <div className="button-row">
                      <button
                        className="secondary"
                        onClick={() =>
                          window.ProjectB?.floatingMarkerSettings?.()
                        }
                      >
                        {t('overlay')}
                      </button>
                      <button
                        className="secondary"
                        onClick={() => {
                          window.ProjectB?.resourceProfile?.();
                          setNotice(t('resourcePrepared'));
                        }}
                      >
                        {t('resourceProfile')}
                      </button>
                    </div>
                  )}
                  <div className="callout">
                    <strong>{t('next')}</strong>
                    <p>
                      {plan
                        ? t(plan.state === 'draft' ? 'pilotNext' : 'formalNext')
                        : t('noPlan')}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => navigate('/plans')}
                    >
                      {t('plans')} →
                    </button>
                  </div>
                </section>
              }
            />
            <Route
              path="/plans"
              element={
                <PlanEditor
                  token={token}
                  spec={spec}
                  plan={plan}
                  working={working}
                  perform={perform}
                  refresh={refresh}
                  choosePlan={choosePlan}
                  exportFile={exportFile}
                />
              }
            />
            <Route
              path="/current"
              element={
                <>
                  {selectedRun && (
                    <RunPanel
                      key={selectedRun.id}
                      run={selectedRun}
                      token={token}
                      clock={clock}
                      spec={plan?.protocol || spec}
                      refresh={refresh}
                      perform={perform}
                      working={working}
                      reportError={reportError}
                      exportFile={exportFile}
                    />
                  )}
                  {!busyRun && (
                    <section className="paper">
                      <div className="eyebrow">02 / {t('next')}</div>
                      <h2>
                        {nextTrial
                          ? resource(nextTrial.mode)
                            ? t(nextTrial.mode)
                            : `${nextTrial.workload} · ${t(nextTrial.phase)}`
                          : t(
                              !plan
                                ? 'noPlan'
                                : plan.state === 'draft'
                                  ? 'pilotQueueReview'
                                  : 'finishedQueue'
                            )}
                      </h2>
                      {plan && nextTrial && (
                        <Preflight
                          key={nextTrial.id}
                          plan={plan}
                          trial={nextTrial}
                          working={
                            working || !!busyRun || !device || !connected
                          }
                          start={startTrial}
                        />
                      )}
                    </section>
                  )}
                </>
              }
            />
            <Route
              path="/history"
              element={<History runs={runs} choose={chooseRun} token={token} />}
            />
            <Route
              path="/analysis"
              element={
                <Comparison
                  token={token}
                  perform={perform}
                  exportFile={exportFile}
                />
              }
            />
          </Routes>
        </main>
        <aside className="review-rail">
          <div className="eyebrow">03 / {t('guide')}</div>
          <h2>{t('prompt')}</h2>
          <blockquote>
            {plan?.protocol.prompt ||
              spec?.prompt ||
              'Open https://www.wikipedia.org in my phone’s browser.'}
          </blockquote>
          <button
            className="secondary full"
            onClick={() =>
              void perform(async () => {
                await navigator.clipboard.writeText(
                  plan?.protocol.prompt || spec?.prompt || ''
                );
                setNotice(t('copied'));
              })
            }
          >
            {t('copy')}
          </button>
          <div className="divider" />
          <h3>{t('protocolQuality')}</h3>
          <p>{t('groundHelp')}</p>
          <p className="muted">{t('rest')}</p>
          <p className="muted">{t('scopeHelp')}</p>
          {selectedRun && (
            <>
              <div className="divider" />
              <small className="mono">{selectedRun.id}</small>
              <p>{new Date(selectedRun.created_at).toLocaleString(locale)}</p>
              <Badge>{t(selectedRun.phase || 'legacy')}</Badge>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function PlanEditor({
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

function Preflight({
  plan,
  trial,
  working,
  start,
}: {
  plan: Campaign;
  trial: Trial;
  working: boolean;
  start: (ready: boolean, ack: boolean) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [ready, setReady] = useState(false);
  const [ack, setAck] = useState(false);
  const locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en';
  return (
    <>
      <p className="lead">
        {resource(trial.mode)
          ? t('resourceInstructions')
          : plan.protocol.workloads[trial.workload].instructions[locale]}
      </p>
      <div className="trial-meta">
        <Badge>{t(trial.phase)}</Badge>
        <span>
          {t('rep')} {trial.repetition}
        </span>
        <span>
          {t('attempt')} {trial.attempt}
        </span>
        <span>{trial.duration_seconds} s</span>
      </div>
      <details className="checklist">
        <summary>{t('preflight')}</summary>
        <ol>
          {plan.protocol.checklist[locale].map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </details>
      <Check
        checked={ready}
        onChange={setReady}
        label={t('preflightConfirm')}
      />
      {trial.mode === 'resource_agent' && (
        <Check checked={ack} onChange={setAck} label={t('stopAck')} />
      )}
      <button
        disabled={
          working ||
          !ready ||
          (trial.mode === 'resource_agent' && !ack) ||
          (!!window.ProjectB && resource(trial.mode))
        }
        onClick={() => void start(ready, ack)}
      >
        {t('start')} →
      </button>
    </>
  );
}

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
  // Polling may update server observations, but must never overwrite an operator draft.
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
  const [quality, setQuality] = useState<Quality>();
  const [files, setFiles] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary>();
  const [resources, setResources] = useState<ResourceSummary>();
  const [reason, setReason] = useState('');
  const [reanalysis, setReanalysis] = useState<{
    id: string;
    summary: Summary;
  }>();
  const [probe, setProbe] = useState<Record<string, boolean>>();
  const reload = useCallback(async () => {
    const [checks, names] = await Promise.all([
      api<Quality>(`runs/${run.id}/quality`, token),
      api<string[]>(`runs/${run.id}/artifacts`, token),
    ]);
    setQuality(checks);
    setFiles(names);
    if (names.includes('summary.json'))
      setSummary(await api<Summary>(`runs/${run.id}/summary.json`, token));
    if (names.includes('resources_summary.json'))
      setResources(
        await api<ResourceSummary>(
          `runs/${run.id}/resources_summary.json`,
          token
        )
      );
  }, [run.id, token]);
  useEffect(() => {
    void reload().catch(reportError);
  }, [reload, run.status, run.outcome, run.browser_package, reportError]);
  // The preparation deadline remains in metadata after sampling starts.
  const boundary =
    run.status === 'settling' && run.settling_until
      ? run.settling_until * 1000
      : run.resource_started_at
        ? (run.resource_started_at + run.duration_seconds) * 1000
        : undefined;
  const last = [...run.markers]
    .reverse()
    .find((marker) =>
      ['idle_start', 'prompt_submitted', 'voice_end'].includes(marker.label)
    );
  const countdown =
    !terminal(run) && last
      ? Math.max(
          0,
          (last.label === 'idle_start' ? 30 : 60) -
            (clock - Date.parse(last.received_at)) / 1000
        )
      : null;
  return (
    <section className="paper">
      <div className="eyebrow">
        {run.workload} / {t(run.mode)} / {t('rep')} {run.repetition}
      </div>
      <h1>{t(run.status)}</h1>
      {!terminal(run) && (
        <>
          <div className="timer">
            {Math.ceil(
              countdown ??
                (boundary
                  ? Math.max(0, (boundary - clock) / 1000)
                  : (clock - Date.parse(run.recording_at || run.created_at)) /
                    1000)
            )}
            <small>s</small>
          </div>
          <p className="muted">
            {t(resource(run.mode) ? 'resourceTimerEstimate' : 'timerEstimate')}
          </p>
        </>
      )}
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
      {summary && <Results summary={summary} />}
      {resources && <Resources result={resources} />}
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
                <Results summary={reanalysis.summary} />
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

function Results({ summary }: { summary: Summary }) {
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

function Resources({ result }: { result: ResourceSummary }) {
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
              <th>{t('metric')}</th>
              <th>{t('median')}</th>
              <th>{t('peak')}</th>
              <th>{t('samples')}</th>
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

function History({
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
              <th>{t('run')}</th>
              <th>{t('capture')}</th>
              <th>{t('actualOutcome')}</th>
              <th>{t('eligible')}</th>
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

function Comparison({
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
                  <th>{t('run')}</th>
                  <th>{t('actualOutcome')}</th>
                  <th>{t('requests')}</th>
                  <th>{t('peers')}</th>
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
                    <th>{t('metric')}</th>
                    <th>{t('median')}</th>
                    <th>{t('range')}</th>
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
                        <th>{t('metric')}</th>
                        <th>{t('delta')}</th>
                        <th>{t('relative')}</th>
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
