import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES, type Role, type UserDTO } from '@touraya/shared';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { qk, useAdminMutation, useUsers } from '@/lib/queries';
import { Badge, Button, Card, Field, Input, Modal, PageLoader, Select, Switch } from '@/components/ui';

const ROLE_HINTS: Record<Role, string> = {
  admin: 'كل شيء',
  manager: 'الطلبات، الإحصائيات، التصدير، تعديل المنتجات',
  agent: 'مشاهدة الطلبات، الاتصال، تغيير الحالة، التعليقات',
  viewer: 'مشاهدة فقط',
};

function UserForm({ user, onClose }: { user: UserDTO | null; onClose: () => void }) {
  const [form, setForm] = useState({ name: user?.name ?? '', email: user?.email ?? '', role: user?.role ?? ('agent' as Role), active: user?.active ?? true, password: '' });
  const save = useAdminMutation(qk.users, (v: typeof form) => {
    const body = { ...v, password: v.password || undefined };
    return user ? api.put(`/users/${user.id}`, body) : api.post('/users', body);
  });
  return (
    <Modal open onClose={onClose} title={user ? 'تعديل الموظف' : 'موظف جديد'} footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form, { onSuccess: onClose })}>حفظ</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="الاسم">{(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label="البريد الإلكتروني">{(id) => <Input id={id} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
        <Field label="الدور" hint={ROLE_HINTS[form.role]}>
          {(id) => (
            <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          )}
        </Field>
        <Field label={user ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'} hint="8 أحرف على الأقل">
          {(id) => <Input id={id} type="password" dir="ltr" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <Switch checked={form.active} onChange={(active) => setForm({ ...form, active })} label="الحساب مفعل" />
      </div>
    </Modal>
  );
}

export function UsersTab() {
  const { data: users, isLoading } = useUsers();
  const [editing, setEditing] = useState<UserDTO | null | 'new'>(null);
  if (isLoading) return <PageLoader />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">كل موظف له حساب خاص، وكل تغيير في الطلبيات يسجل باسمه.</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>موظف جديد</Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-subtle text-xs text-muted">
            <tr>{['الموظف', 'الدور', 'الصلاحيات', 'آخر دخول', 'الحالة', ''].map((h) => <th key={h} className="px-4 py-2.5 text-start font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">{u.name}<div className="ltr text-start text-xs text-faint">{u.email}</div></td>
                <td className="px-4 py-3"><Badge tone={u.role === 'admin' ? 'primary' : 'neutral'}>{ROLE_LABELS[u.role]}</Badge></td>
                <td className="px-4 py-3 text-xs text-muted">{ROLE_PERMISSIONS[u.role].length} صلاحية</td>
                <td className="px-4 py-3 text-xs text-muted">{fmtDateTime(u.lastLoginAt)}</td>
                <td className="px-4 py-3">{u.active ? <Badge tone="ok">مفعل</Badge> : <Badge tone="danger">موقوف</Badge>}</td>
                <td className="px-4 py-3 text-end"><Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(u)}>تعديل</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
