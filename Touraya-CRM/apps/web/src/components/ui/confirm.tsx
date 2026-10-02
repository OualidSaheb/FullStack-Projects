import { useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, type ButtonProps } from './button';
import { Modal } from './overlay';

/** Destructive action behind a confirmation dialog that explains what happens. */
export function ConfirmDelete({
  title,
  children,
  onConfirm,
  loading,
  label = 'حذف',
  size = 'sm',
}: {
  title: string;
  children: ReactNode;
  onConfirm: () => void;
  loading?: boolean;
  label?: string;
  size?: ButtonProps['size'];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={title}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button variant="danger" loading={loading} onClick={() => { onConfirm(); setOpen(false); }}>نعم، احذف</Button>
          </>
        }
      >
        <div className="space-y-2 text-sm">{children}</div>
      </Modal>
    </>
  );
}
