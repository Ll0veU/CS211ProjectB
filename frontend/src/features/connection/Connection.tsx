import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useWorkbenchContext } from '../../app/WorkbenchContext';
import { Badge, Field } from '../../shared/ui';

export function Connection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    token,
    setToken,
    devices,
    device,
    chooseDevice,
    working,
    connect,
    plan,
    setNotice,
  } = useWorkbenchContext();
  return (
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
            onChange={(event) => chooseDevice(event.target.value)}
          >
            <option value="">{t('noDevice')}</option>
            {devices.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
      </div>
      <button disabled={working || !token} onClick={() => void connect()}>
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
            onClick={() => window.ProjectB?.floatingMarkerSettings?.()}
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
        <button className="text-button" onClick={() => navigate('/plans')}>
          {t('plans')} →
        </button>
      </div>
    </section>
  );
}
