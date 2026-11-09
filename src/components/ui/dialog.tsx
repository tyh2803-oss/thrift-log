'use client';
import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Primitive.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content
          className={`dialog-content ${wide ? 'dialog-wide' : ''}`}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const el = e.currentTarget as HTMLElement;
            setTimeout(() => el.querySelector<HTMLInputElement>('input,select,button')?.focus(), 0);
          }}
        >
          <div className="dialog-heading">
            <div>
              <Primitive.Title>{title}</Primitive.Title>
              <Primitive.Description>
                {description || 'Your changes are saved when you submit this form.'}
              </Primitive.Description>
            </div>
            <Primitive.Close aria-label="Close dialog" className="btn btn-ghost btn-icon">
              <X size={20} />
            </Primitive.Close>
          </div>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
