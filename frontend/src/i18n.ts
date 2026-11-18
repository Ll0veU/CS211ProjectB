import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { english, chinese } from './locales/catalog';

const stored =
  localStorage.getItem('projectb.locale') ||
  window.ProjectB?.loadState('locale');
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: english },
    'zh-CN': { translation: chinese },
  },
  lng: stored || (navigator.language.startsWith('zh') ? 'zh-CN' : 'en'),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export { english, chinese } from './locales/catalog';
export default i18n;
