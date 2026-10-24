import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/format';
import { Button } from './Button';
import { Textarea } from './Field';

function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      document.body.style.overflow = 'hidden';
    } else if (!open && d.open) {
      d.close();
    }
    if (!open) document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  return ref;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = useDialog(open);
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="modal-title"
      className={cn('m-auto w-[calc(100%-32px)] rounded-3xl bg-paper p-0 text-ink shadow-lift backdrop:bg-transparent open:animate-rise', width)}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
            <div>
              <h2 id="modal-title" className="font-display text-2xl">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 rounded-full p-2 text-muted hover:bg-blush-50 hover:text-rose-700">
              <X className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-3 border-t border-line px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  side = 'right',
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  side?: 'left' | 'right';
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useDialog(open);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={typeof title === 'string' ? title : undefined}
      className={cn(
        'fixed inset-y-0 m-0 h-dvh max-h-dvh w-[min(420px,100vw)] max-w-none bg-ivory p-0 text-ink shadow-lift',
        side === 'right' ? 'ml-auto mr-0 open:animate-[slide-in-right_.32s_cubic-bezier(.22,1,.36,1)]' : 'mr-auto ml-0 open:animate-[slide-in-left_.32s_cubic-bezier(.22,1,.36,1)]',
      )}
    >
      <style>{`@keyframes slide-in-right{from{transform:translateX(100%)}to{transform:none}}@keyframes slide-in-left{from{transform:translateX(-100%)}to{transform:none}}`}</style>
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div className="font-display text-2xl">{title}</div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-muted hover:bg-blush-50 hover:text-rose-700">
              <X className="size-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="border-t border-line bg-paper px-5 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'primary',
  loading,
  requireReason,
  reasonLabel = 'Reason',
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const invalid = requireReason && reason.trim().length < 3;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Go back
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} disabled={invalid} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="text-sm text-ink-soft">{description}</div>}
      {requireReason && (
        <Textarea
          wrapperClassName="mt-4"
          label={reasonLabel}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={300}
          required
          hint="At least 3 characters."
        />
      )}
    </Modal>
  );
}
