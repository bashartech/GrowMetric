import { RegisterForm } from "@/components/forms/register-form";

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create your organization
        </h1>
        <p className="text-sm text-muted-foreground">
          Set up your account and workspace in a few seconds.
        </p>
      </div>
      <RegisterForm />
    </div>
  );
}
