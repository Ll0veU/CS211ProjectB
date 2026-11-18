import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError, download } from '../api';
import type { Campaign, Locale, Run, Spec } from '../types';
import { storage } from '../shared/storage';
import { terminal } from '../shared/format';

export function useWorkbench() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [token, setToken] = useState(
    () =>
      sessionStorage.getItem('projectb.token') ||
      window.ProjectB?.loadState('token') ||
      ''
  );
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<string[]>([]);
  const [device, setDevice] = useState(() => storage.get('device'));
  const [runs, setRuns] = useState<Run[]>([]);
  const [plans, setPlans] = useState<Campaign[]>([]);
  const [spec, setSpec] = useState<Spec>();
  const [campaignId, setCampaignId] = useState(() => storage.get('campaign'));
  const [runId, setRunId] = useState(() => storage.get('run'));
  const [error, setError] = useState<{ code: string; detail: string }>();
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const pendingRequest = useRef(false);
  const mounted = useRef(true);
  const plan = plans.find((item) => item.id === campaignId);
  const selectedRun = runs.find((item) => item.id === runId);
  const busyRun = runs.find((item) => !terminal(item));
  const nextTrial = plan?.trials.find(
    (item) => !item.superseded && !item.run_ids.length
  );
  const locale: Locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en';

  const reportError = useCallback((failure: unknown) => {
    setError(
      failure instanceof ApiError
        ? { code: failure.code, detail: failure.detail }
        : { code: 'request_failed', detail: String(failure) }
    );
  }, []);
  const refresh = useCallback(async () => {
    if (pendingRequest.current || !token) return;
    pendingRequest.current = true;
    try {
      const [records, campaigns] = await Promise.all([
        api<Run[]>('runs', token),
        api<Campaign[]>('campaigns', token),
      ]);
      if (!mounted.current) return;
      setRuns(records);
      setPlans(campaigns);
      setConnected(true);
      const active = records.find((item) => !terminal(item));
      if (!runId && (active || records[0])) {
        setRunId((active || records[0]).id);
        storage.set('run', (active || records[0]).id);
      }
    } catch (failure) {
      setConnected(false);
      reportError(failure);
    } finally {
      pendingRequest.current = false;
    }
  }, [token, runId, reportError]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!token) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh, token]);
  useEffect(() => {
    document.documentElement.lang = locale;
    window.ProjectB?.setLocale?.(locale);
    storage.set('locale', locale);
  }, [locale]);
  const perform = async (work: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    setError(undefined);
    setNotice('');
    try {
      await work();
    } catch (failure) {
      reportError(failure);
    } finally {
      setWorking(false);
    }
  };
  const connect = () =>
    perform(async () => {
      sessionStorage.setItem('projectb.token', token);
      window.ProjectB?.saveState('token', token);
      const [found, definition] = await Promise.all([
        api<string[]>('devices', token),
        api<Spec>('protocol', token),
      ]);
      setDevices(found);
      setSpec(definition);
      if (!found.includes(device)) {
        setDevice(found[0] || '');
        storage.set('device', found[0] || '');
      }
      await refresh();
      setNotice('connected');
    });
  useEffect(() => {
    if (token && !spec && connected)
      void api<Spec>('protocol', token).then(setSpec).catch(reportError);
  }, [token, spec, connected, reportError]);
  const choosePlan = (value: string) => {
    setCampaignId(value);
    storage.set('campaign', value);
  };
  const chooseRun = (value: string) => {
    setRunId(value);
    storage.set('run', value);
    navigate('/current');
  };
  const chooseDevice = (value: string) => {
    setDevice(value);
    storage.set('device', value);
  };
  const startTrial = (preflight: boolean, ack: boolean) =>
    perform(async () => {
      if (!plan || !nextTrial) return;
      const run = await api<Run>('runs', token, {
        campaign_id: plan.id,
        trial_id: nextTrial.id,
        serial: device,
        preflight_confirmed: preflight,
        controller_stop_ack: ack,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      chooseRun(run.id);
      await refresh();
    });
  const exportFile = (path: string, name: string) =>
    void perform(() => download(path, token, name));
  return {
    token,
    setToken,
    connected,
    devices,
    device,
    runs,
    plans,
    spec,
    campaignId,
    plan,
    selectedRun,
    busyRun,
    nextTrial,
    locale,
    error,
    notice,
    setNotice,
    working,
    reportError,
    refresh,
    perform,
    connect,
    choosePlan,
    chooseRun,
    chooseDevice,
    startTrial,
    exportFile,
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
