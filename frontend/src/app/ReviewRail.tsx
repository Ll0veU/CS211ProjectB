import { useTranslation } from 'react-i18next';
import { Badge } from '../shared/ui';
import { useWorkbenchContext } from './WorkbenchContext';

export function ReviewRail() {
  const { t } = useTranslation();
  const { plan, spec, selectedRun, locale, perform, setNotice } =
    useWorkbenchContext();
  return (
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
  );
}
