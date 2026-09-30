import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errorMessage, qk } from '@/lib/queries';
import { Alert, Button, Field, Input } from '@/components/ui';

export function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/login', { email: form.get('email'), password: form.get('password') });
      await qc.invalidateQueries({ queryKey: qk.me });
      navigate('/orders', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center bg-ink p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-surface p-7 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-primary text-xl font-bold text-white dark:text-ink">T</div>
          <div>
            <h1 className="text-lg font-bold">Touraya CRM</h1>
            <p className="text-sm text-muted">سجّل الدخول لمتابعة الطلبيات</p>
          </div>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="البريد الإلكتروني">{(id) => <Input id={id} name="email" type="email" required autoComplete="username" dir="ltr" />}</Field>
        <Field label="كلمة المرور">{(id) => <Input id={id} name="password" type="password" required autoComplete="current-password" dir="ltr" />}</Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          دخول
        </Button>
      </form>
    </div>
  );
}
