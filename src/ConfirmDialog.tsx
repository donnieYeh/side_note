import { useEffect } from "react";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  checkboxLabel?: string;
  defaultChecked?: boolean;
  destructive?: boolean;
};

export function ConfirmDialog({
  open,
  options,
  checked,
  onCheckedChange,
  onConfirm,
  onCancel
}: {
  open: boolean;
  options: ConfirmOptions | null;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open || !options) return null;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title">{options.title}</h2>
        <p>{options.message}</p>
        {options.checkboxLabel && (
          <label className="confirm-checkbox">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => onCheckedChange(event.target.checked)}
            />
            <span>{options.checkboxLabel}</span>
          </label>
        )}
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onCancel}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={options.destructive ? "confirm-danger" : "confirm-primary"}
            onClick={onConfirm}
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
