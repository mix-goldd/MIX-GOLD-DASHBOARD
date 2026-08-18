import { useEffect, useId, useRef, useState } from 'react';

// A fully custom dropdown that looks and behaves the same on every
// device (no native OS picker on mobile, no inconsistent browser
// styling on desktop). Drop-in replacement for a controlled <select>.
//
// options: array of strings/numbers, or { value, label, disabled }
export default function Dropdown({
  value,
  onChange,
  options = [],
  placeholder = 'اختر…',
  disabled = false,
  className = '',
  id,
  name,
  emptyLabel = 'لا توجد خيارات',
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const reactId = useId();
  const triggerId = id || `dd-${reactId}`;

  const normalized = options.map((o) =>
    o !== null && typeof o === 'object'
      ? { value: String(o.value), label: o.label, disabled: !!o.disabled }
      : { value: String(o), label: String(o), disabled: false }
  );

  const selectedIndex = normalized.findIndex((o) => o.value === String(value ?? ''));
  const selected = selectedIndex >= 0 ? normalized[selectedIndex] : null;

  useEffect(() => {
    if (!open) return undefined;

    function handlePointer(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUp(spaceBelow < 280 && rect.top > spaceBelow);
    }
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0);
    // Focus the menu so arrow keys work immediately.
    requestAnimationFrame(() => menuRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function selectAt(idx) {
    const opt = normalized[idx];
    if (!opt || opt.disabled) return;
    onChange?.(opt.value);
    setOpen(false);
  }

  function handleTriggerKeyDown(e) {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  }

  function handleMenuKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, normalized.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectAt(highlight);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className={`dd ${disabled ? 'dd-disabled' : ''} ${className}`} ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        name={name}
        className={`dd-trigger ${open ? 'dd-trigger-open' : ''}`}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`dd-value ${!selected ? 'dd-placeholder' : ''}`}>
          {selected ? selected.label : placeholder}
        </span>
        <i className={`fas fa-chevron-down dd-chevron ${open ? 'dd-chevron-open' : ''}`} />
      </button>

      {open && (
        <ul
          className={`dd-menu ${openUp ? 'dd-menu-up' : ''}`}
          role="listbox"
          ref={menuRef}
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
        >
          {normalized.length === 0 ? (
            <li className="dd-empty">{emptyLabel}</li>
          ) : (
            normalized.map((opt, idx) => (
              <li
                key={`${opt.value}-${idx}`}
                role="option"
                aria-selected={opt.value === String(value ?? '')}
                className={[
                  'dd-option',
                  idx === highlight ? 'dd-option-highlight' : '',
                  opt.value === String(value ?? '') ? 'dd-option-selected' : '',
                  opt.disabled ? 'dd-option-disabled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => selectAt(idx)}
              >
                <span>{opt.label}</span>
                {opt.value === String(value ?? '') && <i className="fas fa-check dd-check" />}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
