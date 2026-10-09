import { Database, LineChart, Sparkles } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function OnboardingPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-8 p-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-primary">Welcome to GrowMetric</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Let&apos;s connect your business data
        </h1>
        <p className="text-muted-foreground">
          Your organization and default workspace are ready. Data sources and
          analysis arrive in the next phase — nothing is fabricated in the
          meantime.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <Database className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Connect data</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Bring in datasets and sources in the Data Hub.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Ask questions</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Investigate changes with the AI analyst.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <LineChart className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Decide with evidence</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            See recommendations grounded in your own data.
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard" className={buttonVariants()}>
          Go to Dashboard
        </Link>
        <Link
          href="/data-hub/data-sources"
          className={buttonVariants({ variant: "outline" })}
        >
          Open Data Hub
        </Link>
      </div>
    </div>
  );
}
