import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Connection } from '../features/connection/Connection';
import { CurrentTrial } from '../features/runs/CurrentTrial';
import { PlanEditor } from '../features/plans/PlanEditor';
import { History } from '../features/history/History';
import { Comparison } from '../features/analysis/Comparison';
import { WorkbenchHeader } from './WorkbenchHeader';
import { TrialQueue } from './TrialQueue';
import { ReviewRail } from './ReviewRail';
import { useWorkbenchContext } from './WorkbenchContext';

export function WorkbenchLayout() {
  const { t } = useTranslation();
  const state = useWorkbenchContext();
  return (
    <div className="app-shell">
      <WorkbenchHeader />
      {state.error && (
        <div className="alert error" role="alert">
          <strong>{t(state.error.code)}</strong>
          <details>
            <summary>{t('technical')}</summary>
            {state.error.detail}
          </details>
        </div>
      )}
      {state.notice && (
        <div className="alert" role="status">
          {t(state.notice)}
        </div>
      )}
      <div className="workspace">
        <TrialQueue />
        <main>
          <Routes>
            <Route path="/" element={<Connection />} />
            <Route
              path="/plans"
              element={
                <PlanEditor
                  token={state.token}
                  spec={state.spec}
                  plan={state.plan}
                  working={state.working}
                  perform={state.perform}
                  refresh={state.refresh}
                  choosePlan={state.choosePlan}
                  exportFile={state.exportFile}
                />
              }
            />
            <Route path="/current" element={<CurrentTrial />} />
            <Route
              path="/history"
              element={
                <History
                  runs={state.runs}
                  choose={state.chooseRun}
                  token={state.token}
                />
              }
            />
            <Route
              path="/analysis"
              element={
                <Comparison
                  token={state.token}
                  perform={state.perform}
                  exportFile={state.exportFile}
                />
              }
            />
          </Routes>
        </main>
        <ReviewRail />
      </div>
    </div>
  );
}
