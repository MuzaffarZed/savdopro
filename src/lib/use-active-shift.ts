import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export function useActiveShift(warehouseId?: string) {
  const { user, profile, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ["active-shift", user?.id, profile?.branch_id, isSuperAdmin, warehouseId ?? null],
    queryFn: async () => {
      if (!user) return null;
      let q = supabase
        .from("shifts")
        .select("*")
        .eq("status", "open");
      if (warehouseId) q = q.eq("warehouse_id", warehouseId);
      else if (!isSuperAdmin && profile?.branch_id) q = q.eq("branch_id", profile.branch_id);
      else return null;
      const { data } = await q.order("opened_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
    enabled: !!user,
  });
}

// All open shifts visible to the current user.
export function useOpenShifts() {
  const { user, profile, isSuperAdmin } = useAuth();
  return useQuery({
    queryKey: ["open-shifts", user?.id, profile?.branch_id, isSuperAdmin],
    queryFn: async () => {
      if (!user) return [];
      let q = supabase
        .from("shifts")
        .select("*")
        .eq("status", "open")
        .order("opened_at", { ascending: false });
      if (!isSuperAdmin) {
        if (profile?.branch_id) q = q.eq("branch_id", profile.branch_id);
        else q = q.eq("user_id", user.id);
      }
      const { data, error } = await q;
      if (error) throw error;

      const warehouseIds = Array.from(new Set((data ?? []).map((s) => s.warehouse_id).filter(Boolean))) as string[];
      const branchIds = Array.from(new Set((data ?? []).map((s) => s.branch_id).filter(Boolean))) as string[];
      const [{ data: warehouses }, { data: branches }] = await Promise.all([
        warehouseIds.length ? supabase.from("warehouses").select("id,name").in("id", warehouseIds) : Promise.resolve({ data: [] }),
        branchIds.length ? supabase.from("branches").select("id,name").in("id", branchIds) : Promise.resolve({ data: [] }),
      ]);
      const warehouseMap = new Map((warehouses ?? []).map((w) => [w.id, w.name]));
      const branchMap = new Map((branches ?? []).map((b) => [b.id, b.name]));
      return (data ?? []).map((s) => ({
        ...s,
        warehouses: s.warehouse_id ? { name: warehouseMap.get(s.warehouse_id) ?? "—" } : null,
        branches: s.branch_id ? { name: branchMap.get(s.branch_id) ?? "—" } : null,
      }));
    },
    enabled: !!user,
  });
}