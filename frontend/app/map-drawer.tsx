'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function MapDrawer({ side, label, id, forced, children }: {
  side: 'left' | 'right';
  label: string;
  id: string;
  forced: boolean;
  children: ReactNode;
}) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const open = forced || pinned || hover;
  const Chevron = (side === 'left') === open ? ChevronLeft : ChevronRight;

  function close() {
    setPinned(false);
    setHover(false);
    button.current?.focus();
  }

  return <div className={`map-drawer map-drawer-${side}`}
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHover(true); }}
    onPointerLeave={event => {
      if (event.pointerType === 'mouse') setHover(false);
    }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open && !forced) close();
    }}>
    <button ref={button} className="map-drawer-toggle" aria-expanded={open} aria-controls={id}
      onClick={() => {
        if (pinned) close();
        else setPinned(true);
      }}>
      <Chevron size={17}/> {label}
    </button>
    <div id={id} className="map-drawer-body" hidden={!open} onFocus={() => setPinned(true)}>{children}</div>
  </div>;
}
