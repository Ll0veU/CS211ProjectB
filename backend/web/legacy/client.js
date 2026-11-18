export const $ = id => document.getElementById(id);
export const native = window.ProjectB;
export const state = {
  get: key => native ? native.loadState(key) : sessionStorage.getItem(key),
  set: (key, value) => native ? native.saveState(key, value) : sessionStorage.setItem(key, value),
};
export const terminal = new Set(['complete', 'failed']);

export async function api(path, body, raw = false) {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + $('token').value.trim(), 'Content-Type': 'application/json', 'X-ProjectB-Client': native ? 'android' : 'desktop' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw Error((await response.json()).error);
  return raw ? response : response.json();
}
export function action(work) {
  return async event => { event?.preventDefault(); try { await work(); } catch (error) { $('message').textContent = error.message; } };
}
export function select(id, values, selected, placeholder) {
  $(id).replaceChildren(new Option(placeholder, ''), ...values.map(([key, title]) => new Option(title, key)));
  $(id).value = selected;
}
export function list(id, values, empty) {
  $(id).replaceChildren(...(values.length ? values : [empty]).map(value => { const item = document.createElement('li'); item.textContent = value; return item; }));
}
export async function download(path, name) {
  if (native) { native.exportFile(path, $('token').value.trim()); return; }
  const response = await api(path, undefined, true);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function floatingStatus() {
  const supported = native && typeof native.floatingMarkersEnabled === 'function';
  $('floating-settings').disabled = !supported;
  $('floating-status').textContent = !supported ? 'Floating controls require Project B APK 1.3 or newer.'
    : native.floatingMarkersEnabled() ? 'Floating controls enabled. A draggable dot appears on the right during recording; tap to expand the three task markers.'
      : 'Allow Display over other apps for Project B, then return here. Until enabled, use notification markers.';
}
