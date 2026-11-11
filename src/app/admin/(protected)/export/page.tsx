import React from 'react';
import {
  getMessagingProviderMode,
  getReversalApprovalThresholdPaise,
} from '@/lib/services/settings';
import { AdminExportClient } from '@/components/admin/AdminExportClient';

export const dynamic = 'force-dynamic';

export default async function AdminExportPage() {
  const [thresholdPaise, provider] = await Promise.all([
    getReversalApprovalThresholdPaise(),
    getMessagingProviderMode(),
  ]);
  return (
    <AdminExportClient
      initialThresholdPaise={thresholdPaise}
      initialProvider={provider}
    />
  );
}
