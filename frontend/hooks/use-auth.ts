"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import type { AuthContextDTO } from "@/lib/types";

export function useAuthContext() {
  return useQuery<AuthContextDTO | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        return await api.get<AuthContextDTO>("/auth/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
  });
}

export function useAuth() {
  const query = useAuthContext();
  return {
    ...query,
    isAuthenticated: Boolean(query.data),
    user: query.data?.user ?? null,
    organization: query.data?.organization ?? null,
    workspace: query.data?.workspace ?? null,
    subscription: query.data?.subscription ?? null,
  };
}

export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async () => {
      await api.post("/auth/logout");
    },
    onSettled: () => {
      queryClient.clear();
      router.push("/login");
    },
  });
}
