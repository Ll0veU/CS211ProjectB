import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it('connects and verifies package selection through the legacy module entry', async () => {
  const markup = readFileSync(resolve(process.cwd(), '../backend/web/index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(markup, 'text/html').body.innerHTML;
  vi.stubGlobal('setInterval', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (path, options) => {
    const payload = path === '/api/runs' ? [] : path === '/api/devices' ? ['fixture-phone']
      : path === '/api/devices/packages' ? ['com.example.agent']
        : { package: 'com.example.agent', version: 'fixture-v1', version_code: 1, uid: 123 };
    return { ok: true, json: async () => payload };
  }));
  await import('../../backend/web/app.js');
  document.getElementById('token').value = 'fixture';
  fireEvent.click(document.getElementById('connect'));
  await waitFor(() => expect(document.getElementById('message')).toHaveTextContent('Connected.'));
  expect(document.getElementById('device').value).toBe('fixture-phone');
  fireEvent.click(document.getElementById('packages'));
  await waitFor(() => expect(document.querySelector('.package-option')).not.toBeNull());
  fireEvent.click(document.querySelector('.package-option'));
  await waitFor(() => expect(document.getElementById('package-selection')).toHaveTextContent('Version: fixture-v1'));
  expect(document.getElementById('package').value).toBe('com.example.agent');
});
