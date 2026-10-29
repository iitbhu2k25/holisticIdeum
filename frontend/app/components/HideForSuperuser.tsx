'use client';

import { ReactNode } from 'react';
import { useAuth } from '../shared/auth/useAuth';

/** Renders children for everyone except the superuser, who only has the data-upload page. */
export default function HideForSuperuser({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role === 'superuser') return null;
  return <>{children}</>;
}
