import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { smartSearchMatch } from "@/lib/search-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Trash2, Package, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/products")({ component: ProductsPage });

function ProductsPage() {
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; category: string } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").is("deleted_at", null).order("name")).data ?? [],
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("products").insert({ name: name.trim(), category: category.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mahsulot qo'shildi"); setOpen(false); setName(""); setCategory(""); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("products").update({ deleted_at: new Date().toISOString() }).eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const trimmed = editing.name.trim();
      if (!trimmed) throw new Error("Nomi bo'sh bo'lmasligi kerak");
      const { error } = await supabase.from("products").update({ name: trimmed, category: editing.category.trim() || null }).eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Yangilandi"); setEditing(null); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isSuperAdmin) return <Navigate to="/dashboard" />;

  const filtered = (products ?? []).filter(
    (p) => smartSearchMatch(p.name, search) || (p.category && smartSearchMatch(p.category, search))
  );

  return (
    <>
      <PageHeader title="Mahsulotlar" description="Mahsulotlar katalogi" action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1.5" /><span className="hidden sm:inline">Yangi mahsulot</span><span className="sm:hidden">Yangi</span></Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Yangi mahsulot</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Nomi *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Kategoriya</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>Saqlash</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      } />
      <div className="p-3 lg:p-6 pb-24 lg:pb-6 space-y-3 lg:space-y-4">
        <Input placeholder="Qidirish..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:max-w-sm" />
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {filtered.map((p) => (
              <div key={p.id} className="px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate flex items-center gap-1.5"><Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />{p.name}</div>
                  {p.category && <div className="text-[11px] text-muted-foreground truncate">{p.category}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => setEditing({ id: p.id, name: p.name, category: p.category ?? "" })} aria-label="Tahrirlash"><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setRemoveId(p.id)} aria-label="O'chirish"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Mahsulotlar yo'q</div>}
          </div>
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2.5 text-left">Nomi</th><th className="px-4 py-2.5 text-left">Kategoriya</th><th className="px-4 py-2.5 w-24" /></tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2.5 font-medium"><div className="flex items-center gap-2"><Package className="h-4 w-4 text-muted-foreground shrink-0" /><span className="truncate">{p.name}</span></div></td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.category || "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditing({ id: p.id, name: p.name, category: p.category ?? "" })} aria-label="Tahrirlash"><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setRemoveId(p.id)} aria-label="O'chirish"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={3} className="px-4 py-12 text-center text-muted-foreground">Mahsulotlar yo'q</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Mahsulotni tahrirlash</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Nomi *</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Kategoriya</Label><Input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Bekor</Button>
            <Button onClick={() => update.mutate()} disabled={update.isPending || !editing?.name.trim()}>Saqlash</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeId} onOpenChange={(v) => !v && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mahsulotni o'chirish?</AlertDialogTitle>
            <AlertDialogDescription>Mahsulot arxivga ko'chiriladi. Tarixdagi sotuvlar va xaridlar saqlanib qoladi.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (removeId) remove.mutate(removeId); setRemoveId(null); }}>O'chirish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
