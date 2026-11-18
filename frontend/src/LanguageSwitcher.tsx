import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from './types';

const languages: {
  locale: Locale;
  name: string;
  code: string;
  lang: string;
}[] = [
  { locale: 'zh-CN', name: '中文（中国）', code: 'ZH-CN', lang: 'zh-CN' },
  { locale: 'en', name: 'English (United States)', code: 'EN', lang: 'en-US' },
];

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const selected: Locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en';

  useEffect(() => {
    if (!open) return;
    options.current[
      languages.findIndex((language) => language.locale === selected)
    ]?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, selected]);

  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const index = options.current.findIndex(
        (option) => option === document.activeElement
      );
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? languages.length - 1
            : (index +
                (event.key === 'ArrowDown' ? 1 : -1) +
                languages.length) %
              languages.length;
      options.current[next]?.focus();
    }
  };

  const choose = (locale: Locale) => {
    void i18n.changeLanguage(locale);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="language-picker" ref={root} onKeyDown={handleKeys}>
      <button
        ref={trigger}
        type="button"
        className="language-trigger"
        aria-label={t('language')}
        title={t('language')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 8 6 6m-7 0 6-6M2 5h12M7 2h1m14 20-5-11-5 11m2-4h6" />
        </svg>
        <svg
          className="language-chevron"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          className="language-menu"
          id={menuId}
          role="menu"
          aria-label={t('language')}
        >
          {languages.map((language, index) => (
            <button
              key={language.locale}
              type="button"
              ref={(element) => {
                options.current[index] = element;
              }}
              className="language-option"
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={selected === language.locale}
              onClick={() => choose(language.locale)}
            >
              <span lang={language.lang}>{language.name}</span>
              <svg
                className="language-check"
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                {selected === language.locale && <path d="m4 10 4 4 8-8" />}
              </svg>
              <span className="language-code" aria-hidden="true">
                {language.code}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
