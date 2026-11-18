import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { Badge } from '../shared/ui';
import { useWorkbenchContext } from './WorkbenchContext';

export function WorkbenchHeader() {
  const { t } = useTranslation();
  const { connected, device, plan, selectedRun, busyRun } =
    useWorkbenchContext();
  const header = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!header.current) return;
    // Responsive sticky content shares one measured offset with the sidebars.
    const observer = new ResizeObserver((entries) =>
      document.documentElement.style.setProperty(
        '--header-height',
        `${entries[0].target.getBoundingClientRect().height}px`
      )
    );
    observer.observe(header.current);
    return () => observer.disconnect();
  }, []);
  return (
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
        {[
          ['connect', '/'],
          ['plans', '/plans'],
          ['current', '/current'],
          ['history', '/history'],
          ['analysis', '/analysis'],
        ].map(([label, path]) => (
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
  );
}
