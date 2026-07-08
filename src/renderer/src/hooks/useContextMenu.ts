import { useEffect, useState } from 'react';

type MenuState<T> = { target: T; x: number; y: number };

export function useContextMenu<T>() {
  const [menu, setMenu] = useState<MenuState<T> | null>(null);

  useEffect(() => {
    if (!menu) return;
    function close() {
      setMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  function open(target: T, e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ target, x: e.clientX, y: e.clientY });
  }

  function dismissIfUnhandled(e: React.MouseEvent) {
    if (e.defaultPrevented) return;
    setMenu(null);
  }

  return { menu, open, close: () => setMenu(null), dismissIfUnhandled };
}
