import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { resource } from '../shared/format';
import { useWorkbenchContext } from './WorkbenchContext';

export function TrialQueue() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { campaignId, choosePlan, plans, plan, selectedRun, chooseRun } =
    useWorkbenchContext();
  return (
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
              className={`queue-item ${selectedRun && trial.run_ids.includes(selectedRun.id) ? 'selected' : ''}`}
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
  );
}
