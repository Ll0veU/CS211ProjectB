import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import type { Quality, ResourceSummary, Run, Summary } from '../../types';

export function useRunEvidence(
  run: Run,
  token: string,
  reportError: (failure: unknown) => void
) {
  const [quality, setQuality] = useState<Quality>();
  const [files, setFiles] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary>();
  const [resources, setResources] = useState<ResourceSummary>();
  const reload = useCallback(async () => {
    const [checks, names] = await Promise.all([
      api<Quality>(`runs/${run.id}/quality`, token),
      api<string[]>(`runs/${run.id}/artifacts`, token),
    ]);
    setQuality(checks);
    setFiles(names);
    if (names.includes('summary.json'))
      setSummary(await api<Summary>(`runs/${run.id}/summary.json`, token));
    if (names.includes('resources_summary.json'))
      setResources(
        await api<ResourceSummary>(
          `runs/${run.id}/resources_summary.json`,
          token
        )
      );
  }, [run.id, token]);
  useEffect(() => {
    void reload().catch(reportError);
  }, [reload, run.status, run.outcome, run.browser_package, reportError]);
  return { quality, files, summary, resources, reload };
}
