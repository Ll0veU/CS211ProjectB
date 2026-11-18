export const storage = {
  get: (key: string) =>
    localStorage.getItem(`projectb.${key}`) ||
    window.ProjectB?.loadState(key) ||
    '',
  set: (key: string, value: string) => {
    localStorage.setItem(`projectb.${key}`, value);
    window.ProjectB?.saveState(key, value);
  },
};
