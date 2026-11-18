import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Campaign, Trial } from '../../types';
import { resource } from '../../shared/format';
import { Badge, Check } from '../../shared/ui';

export function Preflight({
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
