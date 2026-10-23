import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Warehouse as WhIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/warehouses")({ component: WarehousesPage });

function WarehousesPage() {
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"main" | "branch">("branch");
  const [branchId, setBranchId] = useState<string>("");

  const { data: warehouses } = useQuery({
    queryKey: ["warehouses-all"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name,type,created_at,branches(name)").is("deleted_at", null).order("created_at")).data ?? [],
  });

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").is("deleted_at", null)).data ?? [],
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("warehouses").insert({
        name: name.trim(), type, branch_id: type === "branch" ? branchId || null : null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Sklad qo'shildi"); setOpen(false); setName(""); setBranchId(""); qc.invalidateQueries({ queryKey: ["warehouses-all"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("warehouses").update({ deleted_at: new Date().toISOString() }).eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ["warehouses-all"] }); },
  });

  if (!isSuperAdmin) return <Navigate to="/dashboard" />;

  return (
    <>
      <PageHeader title="Skladlar" description="Asosiy va filial skladlari" action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1.5" /><span className="hidden sm:inline">Yangi sklad</span><span className="sm:hidden">Yangi</span></Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Yangi sklad</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Nomi *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Tipi</Label>
                <Select value={type} onValueChange={(v) => setType(v as "main" | "branch")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="main">Asosiy</SelectItem><SelectItem value="branch">Filial</SelectItem></SelectContent>
                </Select>
              </div>
              {type === "branch" && (
                <div className="space-y-1.5"><Label>Filial</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                    <SelectContent>{(branches ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending || (type === "branch" && !branchId)}>Saqlash</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      } />
      <div className="p-3 lg:p-6 pb-24 lg:pb-6">
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {(warehouses ?? []).map((w) => {
              const b = w.branches as unknown as { name: string } | null;
              return (
                <div key={w.id} className="px-3 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate flex items-center gap-1.5"><WhIcon className="h-3.5 w-3.5 text-primary" />{w.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      <span className="uppercase">{w.type}</span>{b?.name ? ` · ${b.name}` : ""}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => confirm("O'chirilsinmi?") && remove.mutate(w.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              );
            })}
            {(warehouses ?? []).length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Skladlar yo'q</div>}
          </div>
          <div className="hidden sm:block overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2.5 text-left">Nomi</th><th className="px-4 py-2.5 text-left">Tipi</th><th className="px-4 py-2.5 text-left">Filial</th><th className="px-4 py-2.5 w-12" /></tr>
            </thead>
            <tbody className="divide-y">
              {(warehouses ?? []).map((w) => {
                const b = w.branches as unknown as { name: string } | null;
                return (
                  <tr key={w.id}>
                    <td className="px-4 py-2.5 font-medium flex items-center gap-2"><WhIcon className="h-4 w-4 text-primary" />{w.name}</td>
                    <td className="px-4 py-2.5 text-xs uppercase">{w.type}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{b?.name ?? "—"}</td>
                    <td className="px-4 py-2.5"><Button size="icon" variant="ghost" onClick={() => confirm("O'chirilsinmi?") && remove.mutate(w.id)}><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                );
              })}
              {(warehouses ?? []).length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">Skladlar yo'q</td></tr>}
            </tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}