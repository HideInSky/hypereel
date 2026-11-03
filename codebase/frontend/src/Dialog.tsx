import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

/**
 * A modal on the native <dialog>: the page behind is inert (focus stays inside),
 * Escape closes it, and focus goes back where it was. Mount it to open it.
 */
export default function Dialog({ title, onClose, children, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const back = document.activeElement as HTMLElement | null;
    if (!el.open) el.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    el.addEventListener("cancel", onCancel);
    return () => {
      el.removeEventListener("cancel", onCancel);
      if (el.open) el.close();
      back?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog${className ? ` ${className}` : ""}`}
      aria-label={title}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
