'use client';
import { Button } from './ui/button';

/** Shares the form's normal submit path, native validation and saving state. */
export function FormSaveBar({
  summary,
  label = 'Save Changes',
  accessibleLabel = 'Save form changes at top',
  disabled,
  busy,
  onSave,
}: {
  summary: React.ReactNode;
  label?: string;
  accessibleLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  onSave?: () => void;
}) {
  return (
    <div className="form-top-actions">
      <span>{summary}</span>
      <Button
        type={onSave ? 'button' : 'submit'}
        aria-label={accessibleLabel}
        disabled={disabled || busy}
        onClick={onSave}
      >
        {busy ? 'Saving…' : label}
      </Button>
    </div>
  );
}
