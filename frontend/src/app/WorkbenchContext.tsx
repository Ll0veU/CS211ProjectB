import { createContext, useContext, type ReactNode } from 'react';
import { useWorkbench, type Workbench } from './useWorkbench';

const Context = createContext<Workbench | undefined>(undefined);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const workbench = useWorkbench();
  return <Context.Provider value={workbench}>{children}</Context.Provider>;
}

export function useWorkbenchContext() {
  const value = useContext(Context);
  if (!value) throw new Error('WorkbenchProvider is required');
  return value;
}
