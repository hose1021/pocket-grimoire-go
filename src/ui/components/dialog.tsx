// Radix owns the focus trap, Escape, focus restore, `aria-modal` and the
// title-to-content name association. Styling stays in the shared tokens.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  trigger: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  closeLabel: string;
  /** Replaces the single close control when the dialog owns its own actions. */
  footer?: ReactNode;
}

/** A control that closes the dialog; the caller supplies the markup. */
export function DialogClose({ children }: { children: ReactNode }) {
  return <DialogPrimitive.Close asChild>{children}</DialogPrimitive.Close>;
}

export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  closeLabel,
  footer,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-shell-overlay=""
          className="fixed inset-0 z-1000 bg-crypt/80"
        />
        <DialogPrimitive.Content
          aria-modal="true"
          className="fixed left-1/2 top-1/2 z-1000 max-h-[calc(100dvh-24px)] w-[min(calc(100vw-24px),560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-(--radius) border border-edge-2 bg-crypt-2 p-(--pad) text-text shadow-lg"
        >
          <DialogPrimitive.Title className="mb-2 text-base font-semibold">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mb-3 text-sm text-muted">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {children}
          {footer ?? (
            <DialogPrimitive.Close asChild>
              <button className="btn mt-4" type="button" data-act="close">
                {closeLabel}
              </button>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
