import { useEffect } from 'react';
export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    const leave = (e: MouseEvent) => {
      if (dirty && (e.target as HTMLElement).closest('a[href]') && !window.confirm('Discard your unsaved changes?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', leave, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', leave, true);
    };
  }, [dirty]);
}
