import type { AlertDTO } from '@/lib/types/notifications';

interface Props {
  alert: AlertDTO;
  onStatusChange?: (id: string, status: string) => void;
}

export function AlertCard({ alert, onStatusChange }: Props) {
  return (
    <div className={`border rounded-lg p-4 ${alert.severity === 'CRITICAL' ? 'border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.15)]' : 'border-border'}`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold">{alert.title}</h3>
          <p className="text-sm">{alert.message}</p>
          <span className="text-xs">{alert.severity} — {alert.status}</span>
        </div>
        {alert.status === 'OPEN' && (
          <button onClick={() => onStatusChange?.(alert.id, 'ACKNOWLEDGED')} className="px-3 py-1 text-sm bg-card border rounded">Acknowledge</button>
        )}
      </div>
    </div>
  );
}
