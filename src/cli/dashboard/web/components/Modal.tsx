import { type ComponentChildren, createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { useModalTransition } from '../hooks/useModalTransition.ts';

interface ModalProps {
  /** Whether the modal is open. Drives mount, enter, and exit animation. */
  open: boolean;
  /** Called when the backdrop is dismissed (click outside). */
  onClose: () => void;
  /**
   * Backdrop class that controls placement/elevation. Each modal family keeps
   * its own (confirmBackdrop, cmdkBackdrop, modalBackdrop); the shared
   * open/close motion is applied via these classes in styles.css.
   */
  backdropClass?: string;
  children: ComponentChildren;
}

const ModalGuardContext = createContext<(canClose: boolean) => void>(() => {});

/**
 * Shared modal shell. Owns the open/close transition so individual modals
 * don't repeat the wiring: it keeps the element mounted through the exit
 * animation, applies `is-closing` for the reverse motion, dismisses on
 * backdrop click, and unmounts its children when fully closed (which resets
 * any form state inside them). Children whose dismissal depends on internal
 * state (e.g. an in-flight upload) call useModalCanClose to gate closing.
 */
export function Modal({ open, onClose, backdropClass = 'modalBackdrop', children }: ModalProps) {
  const { mounted, closing } = useModalTransition(open);
  const [canClose, setCanClose] = useState(true);
  // Freeze the last open children so content stays intact while animating out,
  // even when it was derived from state that clears on close.
  const lastChildren = useRef<ComponentChildren>(children);
  if (open) lastChildren.current = children;

  if (!mounted) return null;

  return (
    <div
      class={`${backdropClass}${closing ? ' is-closing' : ''}`}
      role="presentation"
      tabIndex={-1}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && canClose) onClose();
      }}
    >
      <ModalGuardContext.Provider value={setCanClose}>
        {open ? children : lastChildren.current}
      </ModalGuardContext.Provider>
    </div>
  );
}

/**
 * Lets modal content veto backdrop dismissal while `canClose` is false
 * (e.g. during an in-flight upload). No-op outside a <Modal>.
 */
export function useModalCanClose(canClose: boolean): void {
  const setCanClose = useContext(ModalGuardContext);
  useEffect(() => {
    setCanClose(canClose);
    return () => setCanClose(true);
  }, [canClose, setCanClose]);
}
