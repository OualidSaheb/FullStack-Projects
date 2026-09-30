import { useEffect, useState } from 'react';
import type { Settings } from '@touraya/shared';
import { api } from '@/lib/api';
import { qk, useAdminMutation, useSettings } from '@/lib/queries';

/** Local editable copy of the settings; saving sends the whole object (token left empty = unchanged). */
export function useSettingsForm() {
  const { data } = useSettings();
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (data) setForm({ ...data, yalidine: { ...data.yalidine, apiToken: '' } });
  }, [data]);
  const save = useAdminMutation(qk.settings, (v: Settings) => api.put('/settings', v));
  return { data, form, setForm, save };
}
