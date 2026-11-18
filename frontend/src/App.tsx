import { WorkbenchProvider } from './app/WorkbenchContext';
import { WorkbenchLayout } from './app/WorkbenchLayout';

export default function App() {
  return (
    <WorkbenchProvider>
      <WorkbenchLayout />
    </WorkbenchProvider>
  );
}
