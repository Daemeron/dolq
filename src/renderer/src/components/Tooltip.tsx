import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { placeTip } from '../utils/placeTip';

const SHOW_DELAY_MS = 250;

// One tooltip for every `data-tip` element. It lives at the top of the page, so no clipping parent or window edge cuts it off.
export function Tooltip() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (e: Event) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null;
      clearTimeout(timer);
      setTarget(null);
      if (el) timer = setTimeout(() => setTarget(el), SHOW_DELAY_MS);
    };
    const hide = () => show(new Event('hide'));
    document.addEventListener('mouseover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('mousedown', hide);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mouseover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!target || !ref.current) return setPos(null);
    const { width, height } = ref.current.getBoundingClientRect();
    setPos(
      placeTip(
        target.getBoundingClientRect(),
        { width, height },
        { width: window.innerWidth, height: window.innerHeight },
        target.classList.contains('tip-right') ? 'right' : 'below',
      ),
    );
  }, [target]);

  if (!target?.isConnected) return null;
  return (
    <div
      ref={ref}
      role="tooltip"
      className="dolq-tip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      {target.dataset.tip}
    </div>
  );
}
