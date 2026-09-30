import type { Permission } from '@touraya/shared';
import { useMe } from './queries';

export function useCan() {
  const { data: me } = useMe();
  return (permission: Permission) => Boolean(me?.permissions.includes(permission));
}
