import type { ReportDTO } from '@/lib/types/reports';

interface Props {
  report: ReportDTO;
  onGenerate?: (id: string) => void;
}

export function ReportCard({ report, onGenerate }: Props) {
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{report.title}</h3>
          <span className="text-sm">{report.kind} — {report.status}</span>
        </div>
        <div className="flex gap-2">
          {report.status === 'DRAFT' && <button onClick={() => onGenerate?.(report.id)} className="px-3 py-1 text-sm bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded">Generate</button>}
          {report.pdfUrl && <a href={report.pdfUrl} target="_blank" rel="noopener" className="px-3 py-1 text-sm bg-[var(--success)] text-white rounded">PDF</a>}
        </div>
      </div>
    </div>
  );
}
