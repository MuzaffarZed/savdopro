import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PricelistOverride = { markup?: number; price?: number };

export function usePricelist() {
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ["pricelist-settings"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("pricelist_settings").select("default_markup").eq("id", true).maybeSingle();
        if (error) {
          console.warn("pricelist_settings query warning:", error.message);
          return 30;
        }
        return Number(data?.default_markup ?? 30);
      } catch (err) {
        return 30;
      }
    },
    staleTime: 60_000,
  });

  const overridesQ = useQuery({
    queryKey: ["pricelist-overrides"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("pricelist_overrides").select("product_id,markup,price");
        if (error) {
          console.warn("pricelist_overrides query warning:", error.message);
          return {};
        }
        const map: Record<string, PricelistOverride> = {};
        (data ?? []).forEach((r) => {
          map[r.product_id] = {
            markup: r.markup === null ? undefined : Number(r.markup),
            price: r.price === null ? undefined : Number(r.price),
          };
        });
        return map;
      } catch (err) {
        return {};
      }
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      const channelId = `pricelist-rt-${Math.random().toString(36).slice(2, 9)}`;
      ch = supabase
        .channel(channelId)
        .on("postgres_changes", { event: "*", schema: "public", table: "pricelist_overrides" }, () => {
          qc.invalidateQueries({ queryKey: ["pricelist-overrides"] });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "pricelist_settings" }, () => {
          qc.invalidateQueries({ queryKey: ["pricelist-settings"] });
        });
      ch.subscribe();
    } catch (err) {
      console.warn("Realtime pricelist subscription error caught:", err);
    }
    return () => {
      if (ch) {
        try {
          supabase.removeChannel(ch);
        } catch (_) {}
      }
    };
  }, [qc]);

  return {
    defaultMarkup: settingsQ.data ?? 30,
    overrides: overridesQ.data ?? {},
    isLoading: settingsQ.isLoading || overridesQ.isLoading,
  };
}

export async function setDefaultMarkup(markup: number) {
  const { error } = await supabase
    .from("pricelist_settings")
    .upsert({ id: true, default_markup: markup, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function upsertOverride(productId: string, override: PricelistOverride) {
  const { error } = await supabase
    .from("pricelist_overrides")
    .upsert({
      product_id: productId,
      markup: override.markup ?? null,
      price: override.price ?? null,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

export async function deleteOverride(productId: string) {
  const { error } = await supabase.from("pricelist_overrides").delete().eq("product_id", productId);
  if (error) throw error;
}

export async function deleteAllOverrides() {
  const { error } = await supabase.from("pricelist_overrides").delete().neq("product_id", "00000000-0000-0000-0000-000000000000");
  if (error) throw error;
}