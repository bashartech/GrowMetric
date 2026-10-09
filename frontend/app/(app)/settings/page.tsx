"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RenameForm } from "@/components/forms/rename-form";
import { useAuth } from "@/hooks/use-auth";
import { api, ApiError } from "@/lib/api-client";
import type { RenameValues } from "@/lib/schemas";

function messageFor(error: unknown): string | null {
  if (error instanceof ApiError) return error.message;
  if (error) return "Something went wrong. Please try again.";
  return null;
}

export default function SettingsPage() {
  const { organization, workspace, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["auth", "me"] });

  const organizationMutation = useMutation({
    mutationFn: (values: RenameValues) =>
      api.patch("/organizations/current", values),
    onSuccess: invalidate,
  });

  const workspaceMutation = useMutation({
    mutationFn: (values: RenameValues) =>
      api.patch(`/workspaces/${workspace!.id}`, values),
    onSuccess: invalidate,
  });

  if (isLoading || !organization || !workspace) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your organization and workspace details.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization</CardTitle>
          <CardDescription>
            Shown across the app shell. Slugs stay stable in this phase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RenameForm
            id="organization-name"
            fieldLabel="Organization name"
            initialName={organization.name}
            submitLabel="Save organization"
            isPending={organizationMutation.isPending}
            errorMessage={messageFor(organizationMutation.error)}
            successMessage={
              organizationMutation.isSuccess ? "Organization updated." : null
            }
            onSubmit={(values) => organizationMutation.mutate(values)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace</CardTitle>
          <CardDescription>
            Your default workspace for data and investigations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RenameForm
            id="workspace-name"
            fieldLabel="Workspace name"
            initialName={workspace.name}
            submitLabel="Save workspace"
            isPending={workspaceMutation.isPending}
            errorMessage={messageFor(workspaceMutation.error)}
            successMessage={
              workspaceMutation.isSuccess ? "Workspace updated." : null
            }
            onSubmit={(values) => workspaceMutation.mutate(values)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
