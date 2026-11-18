import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkbenchContext } from '../../app/WorkbenchContext';
import { resource } from '../../shared/format';
import { Preflight } from '../plans/Preflight';
import { RunPanel } from './RunPanel';

export function CurrentTrial() {
  const { t } = useTranslation();
  const workbench = useWorkbenchContext();
  const {
    selectedRun,
    busyRun,
    plan,
    nextTrial,
    working,
    device,
    connected,
    spec,
    startTrial,
  } = workbench;
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      {selectedRun && (
        <RunPanel
          key={selectedRun.id}
          run={selectedRun}
          token={workbench.token}
          clock={clock}
          spec={plan?.protocol || spec}
          refresh={workbench.refresh}
          perform={workbench.perform}
          working={working}
          reportError={workbench.reportError}
          exportFile={workbench.exportFile}
        />
      )}
      {!busyRun && (
        <section className="paper">
          <div className="eyebrow">02 / {t('next')}</div>
          <h2>
            {nextTrial
              ? resource(nextTrial.mode)
                ? t(nextTrial.mode)
                : `${nextTrial.workload} · ${t(nextTrial.phase)}`
              : t(
                  !plan
                    ? 'noPlan'
                    : plan.state === 'draft'
                      ? 'pilotQueueReview'
                      : 'finishedQueue'
                )}
          </h2>
          {plan && nextTrial && (
            <Preflight
              key={nextTrial.id}
              plan={plan}
              trial={nextTrial}
              working={working || !device || !connected}
              start={startTrial}
            />
          )}
        </section>
      )}
    </>
  );
}
