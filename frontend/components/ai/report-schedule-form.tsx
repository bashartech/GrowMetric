import type { ReportScheduleDTO } from '@/lib/types/reports';

interface Props {
  schedule: ReportScheduleDTO;
  onChange?: (id: string, data: Partial<ReportScheduleDTO>) => void;
}

export function ReportScheduleForm({ schedule, onChange }: Props) {
  return (
    <form className="space-y-4">
      <select defaultValue={schedule?.frequency} onChange={e => onChange?.(schedule?.id, { frequency: e.target.value as ReportScheduleDTO['frequency'] })} className="px-3 py-2 border rounded">
        <option value="DAILY">Daily</option>
        <option value="WEEKLY">Weekly</option>
        <option value="MONTHLY">Monthly</option>
      </select>
      <input type="text" defaultValue={schedule?.timezone} placeholder="Timezone" className="w-full px-3 py-2 border rounded" />
      <button type="submit" className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded">Save</button>
    </form>
  );
}
