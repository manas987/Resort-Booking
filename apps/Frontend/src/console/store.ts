import { createContext, useContext } from 'react';
import type { Command, Employee, State } from './model';
export type ConsoleStore = {
  state: State;
  actor: Employee;
  exec: (command: Command) => boolean;
  notify: (text: string) => void;
  navigate: (path: string) => void;
  error?: string;
};
export const ConsoleContext = createContext<ConsoleStore | null>(null);
export function useConsole() {
  const store = useContext(ConsoleContext);
  if (!store) throw new Error('Console context missing');
  return store;
}
