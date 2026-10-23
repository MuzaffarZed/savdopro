import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Building2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_app/branches")({ component: BranchesPage });

type Branch = {
  id: string;
  name: string;
  address: string | null;
  created_at: string;
};

function BranchesPage() {
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState<Branch | null>(null);
  const [eName, setEName] = useState("");
  const [eAddress, setEAddress] = useState("");

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () =>
      ((await supabase.from("branches").select("*").is("deleted_at", null).order("created_at")).data ?? []) as Branch[],
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("branches").insert({ name: name.trim(), address: address.trim() || null });
      if (error) throw error;
      // Create branch warehouse
      const { data: b } = await supabase.from("branches").select("id").eq("name", name.trim()).order("created_at", { ascending: false }).limit(1).single();
      if (b) await supabase.from("warehouses").insert({ name: `${name.trim()} ombori`, type: "branch", branch_id: b.id });
    },
    onSuccess: () => {
      toast.success("Filial yaratildi");
      setOpen(false); setName(""); setAddress("");
      qc.invalidateQueries({ queryKey: ["branches"] });
      qc.invalidateQueries({ queryKey: ["warehouses"] });
    },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  const softDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("branches").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ["branches"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase
        .from("branches")
        .update({
          name: eName.trim(),
          address: eAddress.trim() || null,
        })
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saqlandi");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["branches"] });
    },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  function openEdit(b: Branch) {
    setEditing(b);
    setEName(b.name);
    setEAddress(b.address ?? "");
  }

  if (!isSuperAdmin) return <Navigate to="/dashboard" />;

  return (
    <>
      <PageHeader title="Filiallar" description="Filial CRUD — har bir filial avtomatik o'z omborini oladi" action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1.5" /><span className="hidden sm:inline">Yangi filial</span><span className="sm:hidden">Yangi</span></Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Yangi filial</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Nomi *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Markaz filial" /></div>
              <div className="space-y-1.5"><Label>Manzil</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>Saqlash</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      } />
      <div className="p-3 lg:p-6 pb-24 lg:pb-6">
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {(branches ?? []).map((b) => (
              <div key={b.id} className="px-3 py-2.5 flex items-center gap-3">
                <div className="h-12 w-12 rounded-md bg-muted flex items-center justify-center"><Building2 className="h-5 w-5 text-muted-foreground" /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{b.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{b.address || "—"}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => openEdit(b)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => confirm("O'chirilsinmi?") && softDelete.mutate(b.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {(branches ?? []).length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Filiallar yo'q</div>}
          </div>
          <div className="hidden sm:block overflow-x-auto"><table className="w-full text-sm min-w-[520px]">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2.5 text-left">Nomi</th><th className="px-4 py-2.5 text-left">Manzil</th><th className="px-4 py-2.5 text-left">Yaratilgan</th><th className="px-4 py-2.5 w-24" /></tr>
            </thead>
            <tbody className="divide-y">
              {(branches ?? []).map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2.5 font-medium">{b.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{b.address || "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(b.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(b)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => confirm("O'chirilsinmi?") && softDelete.mutate(b.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {(branches ?? []).length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">Filiallar yo'q</td></tr>}
            </tbody>
          </table></div>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Filialni tahrirlash</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Nomi *</Label><Input value={eName} onChange={(e) => setEName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Manzil</Label><Input value={eAddress} onChange={(e) => setEAddress(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={() => update.mutate()} disabled={!eName.trim() || update.isPending}>Saqlash</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
