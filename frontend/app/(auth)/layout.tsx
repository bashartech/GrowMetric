import type { ReactNode } from "react";
import Image from "next/image";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-[#070A10] p-10 text-[#94A3B8] lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(124,58,237,0.16),transparent_55%)]" aria-hidden />
        <div className="relative z-10 flex items-center gap-2">
          {/* <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3B82F6] text-sm font-bold text-white">DD</span> */}
          <Image
            src="/images/logo.png"
            alt="GrowMetric"
            width={1254}
            height={1254}
            className="h-8 w-8 rounded-lg object-contain"
          />
          <span className="text-lg font-semibold text-white">GrowMetric</span>
        </div>
        <div className="relative z-10 space-y-4">
          <h1 className="text-3xl font-semibold leading-tight text-white">
            Turn your business data into confident decisions.
          </h1>
          <p className="max-w-md text-sm text-[#94A3B8]">
            A decision intelligence workspace that connects your data, runs
            investigations, and explains every recommendation.
          </p>
        </div>
        <p className="relative z-10 text-xs text-[#64748B]">
          AI Business Intelligence &amp; Decision Intelligence
        </p>
      </div>
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
