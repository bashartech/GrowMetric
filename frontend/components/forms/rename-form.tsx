"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameSchema, type RenameValues } from "@/lib/schemas";

interface RenameFormProps {
  id: string;
  fieldLabel: string;
  initialName: string;
  submitLabel: string;
  isPending: boolean;
  errorMessage: string | null;
  successMessage?: string | null;
  onSubmit: (values: RenameValues) => void;
}

export function RenameForm({
  id,
  fieldLabel,
  initialName,
  submitLabel,
  isPending,
  errorMessage,
  successMessage,
  onSubmit,
}: RenameFormProps) {
  const form = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    values: { name: initialName },
  });

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="space-y-3"
      noValidate
    >
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      {successMessage ? (
        <Alert>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={id}>{fieldLabel}</Label>
        <Input id={id} {...form.register("name")} />
        {form.formState.errors.name ? (
          <p className="text-sm text-destructive">
            {form.formState.errors.name.message}
          </p>
        ) : null}
      </div>

      <Button type="submit" size="sm" loading={isPending} disabled={isPending}>
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
