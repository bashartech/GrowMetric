import type { AlertRuleDTO } from '@/lib/types/notifications';

interface Props {
  rule: AlertRuleDTO;
}

export function AlertRuleForm({ rule }: Props) {
  return (
    <form className="space-y-4">
      <input defaultValue={rule?.name} placeholder="Rule name" className="w-full px-3 py-2 border rounded" />
      <input defaultValue={rule?.metricKind} placeholder="Metric kind" className="w-full px-3 py-2 border rounded" />
      <input type="number" defaultValue={rule?.threshold} placeholder="Threshold" className="w-full px-3 py-2 border rounded" />
      <button type="submit" className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded">Save</button>
    </form>
  );
}
