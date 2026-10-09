import { Construction } from "lucide-react";
import { EmptyState } from "./empty-state";

interface ComingSoonProps {
  title: string;
  description: string;
}

export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          Coming soon
        </span>
      </div>
      <EmptyState
        icon={<Construction className="h-8 w-8" aria-hidden />}
        title={`${title} is planned for a later phase`}
        description={description}
      />
    </div>
  );
}
