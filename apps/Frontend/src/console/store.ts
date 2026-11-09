import { createContext, useContext } from 'react';

/** What the shell still offers its screens, now that every one of them fetches its own data:
 *  a toast, navigation that also closes the mobile nav, and the shell-level error slot.
 *  It used to carry the whole fixture `state`, the fixture `actor` and an `exec` reducer. */
export type ConsoleStore = {
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
