import { $, native, api, action } from './client.js';

export function packagePicker() {
  let installedApps = [], packageGeneration = 0, detailGeneration = 0, packagesLoaded = false;
  function clearPackages() {
    packageGeneration++; detailGeneration++; installedApps = []; packagesLoaded = false;
    $('package').value = ''; $('package-results').replaceChildren();
    $('package-status').textContent = 'Load apps for the selected device.';
    $('package-selection').textContent = 'No app selected.'; $('packages').disabled = false;
  }
  function renderPackages() {
    const query = $('package-search').value.trim().toLocaleLowerCase();
    const matches = installedApps.filter(app => ($('all-packages').checked || app.names.length) && [app.package, ...app.names].some(value => value.toLocaleLowerCase().includes(query)));
    $('package-results').replaceChildren(...matches.map(app => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'package-option';
      button.setAttribute('aria-pressed', String(app.package === $('package').value.trim()));
      const title = document.createElement('strong'); title.textContent = app.names.join(' / ') || 'App name unavailable';
      const name = document.createElement('span'); name.textContent = app.package; button.append(title, name);
      button.onclick = action(async () => { $('package').value = app.package; renderPackages(); await checkPackage(); }); return button;
    }));
    if (packagesLoaded) $('package-status').textContent = matches.length ? `${matches.length} matching apps / ${installedApps.length} installed packages. Tap an app to select it.`
      : 'No matching apps. Try another keyword, include unnamed packages, or enter the package manually.';
  }
  async function checkPackage() {
    const generation = ++detailGeneration, serial = $('device').value, name = $('package').value.trim();
    if (!serial || !name) { $('package-selection').textContent = 'Select a device and enter a package first.'; return; }
    $('package-selection').textContent = 'Checking installation and version…';
    try {
      const details = await api('devices/package-details', { serial, package: name });
      if (generation !== detailGeneration || serial !== $('device').value || name !== $('package').value.trim()) return;
      const app = installedApps.find(item => item.package === name);
      $('package-selection').textContent = `Selected: ${app?.names.join(' / ') || 'App name unavailable'}\nPackage: ${details.package}\nVersion: ${details.version || 'unavailable'}\nVersion code: ${details.version_code ?? 'unavailable'}\nUID: ${details.uid}`;
    } catch (error) { if (generation === detailGeneration) $('package-selection').textContent = 'Could not verify package: ' + error.message; }
  }
  $('packages').onclick = action(async () => {
    const serial = $('device').value;
    if (!serial) { $('package-status').textContent = 'Connect and select an ADB device first.'; return; }
    clearPackages(); const generation = packageGeneration;
    $('packages').disabled = true; $('package-status').textContent = 'Loading installed packages…';
    try {
      const packages = await api('devices/packages', { serial });
      if (generation !== packageGeneration || serial !== $('device').value) return;
      const labels = new Map();
      if (native && typeof native.appLabels === 'function') {
        try { for (const app of JSON.parse(native.appLabels())) { if (!labels.has(app.package)) labels.set(app.package, new Set()); labels.get(app.package).add(app.name); } }
        catch (_) { /* Package-only search is still usable. */ }
      }
      installedApps = packages.map(name => ({ package: name, names: [...(labels.get(name) || [])] }));
      installedApps.sort((first, second) => (first.names[0] || first.package).localeCompare(second.names[0] || second.package));
      const hasLabels = installedApps.some(app => app.names.length); $('all-packages').checked = !hasLabels;
      $('package-help').textContent = hasLabels ? 'Search app names or package names. Names come from this phone: select this same phone in ADB. Versions are checked on the selected ADB device.'
        : 'Package-name search is available. For app-name search, install the updated Project B APK on the selected phone. Unavailable names are not guessed.';
      packagesLoaded = true; renderPackages();
    } catch (error) { if (generation === packageGeneration) $('package-status').textContent = 'Could not load apps: ' + error.message + '. Check the connection and retry.'; }
    finally { if (generation === packageGeneration) $('packages').disabled = false; }
  });
  $('device').addEventListener('change', clearPackages);
  $('package-search').addEventListener('input', renderPackages); $('all-packages').addEventListener('change', renderPackages);
  $('package-check').onclick = action(checkPackage);
  $('package').addEventListener('input', () => { detailGeneration++; $('package-selection').textContent = 'Manual entry: click Check selected package to verify installation and version.'; renderPackages(); });
  return { clearPackages };
}
