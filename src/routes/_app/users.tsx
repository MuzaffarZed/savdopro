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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { fmtDate } from "@/lib/format";
import { Plus, UserCog, Mail, Phone, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/users")({ component: UsersPage });

type ProfileRow = {
  id: string;
  name: string;
  phone: string | null;
  username: string | null;
  branch_id: string | null;
  created_at: string;
  branches: { name: string } | null;
};

function UsersPage() {
  const { isSuperAdmin, user: currentUser } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", phone: "", branch_id: "", role: "branch_user" as "super_admin" | "branch_user" });
  const [editing, setEditing] = useState<ProfileRow | null>(null);
  const [editForm, setEditForm] = useState({ email: "", password: "", name: "", phone: "", branch_id: "", role: "branch_user" as "super_admin" | "branch_user" });
  const [deleting, setDeleting] = useState<ProfileRow | null>(null);

  const { data: profiles } = useQuery({
    queryKey: ["profiles-admin"],
    queryFn: async () => (await supabase.from("profiles").select("id,name,phone,username,branch_id,created_at,branches(name)").order("created_at", { ascending: false })).data ?? [],
    enabled: isSuperAdmin,
  });
  const { data: roles } = useQuery({
    queryKey: ["all-roles"],
    queryFn: async () => (await supabase.from("user_roles").select("user_id,role")).data ?? [],
    enabled: isSuperAdmin,
  });
  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name").is("deleted_at", null)).data ?? [],
    enabled: isSuperAdmin,
  });

  const createUser = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("admin-create-user", {
        body: { action: "create", ...form, branch_id: form.branch_id || null },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Foydalanuvchi yaratildi");
      setOpen(false);
      setForm({ email: "", password: "", name: "", phone: "", branch_id: "", role: "branch_user" });
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateUser = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("No user");
      const payload: Record<string, unknown> = {
        action: "update",
        user_id: editing.id,
        name: editForm.name,
        phone: editForm.phone,
        branch_id: editForm.branch_id || null,
        role: editForm.role,
      };
      if (editForm.email && editForm.email !== editing.username) payload.email = editForm.email;
      if (editForm.password) payload.password = editForm.password;
      const { error } = await supabase.functions.invoke("admin-create-user", { body: payload });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Foydalanuvchi yangilandi");
      setEditing(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteUser = useMutation({
    mutationFn: async () => {
      if (!deleting) throw new Error("No user");
      const { error } = await supabase.functions.invoke("admin-create-user", {
        body: { action: "delete", user_id: deleting.id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Foydalanuvchi o'chirildi");
      setDeleting(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isSuperAdmin) return <Navigate to="/dashboard" />;

  const roleMap = new Map<string, string[]>();
  (roles ?? []).forEach((r) => {
    const arr = roleMap.get(r.user_id) ?? [];
    arr.push(r.role);
    roleMap.set(r.user_id, arr);
  });

  const openEdit = (p: ProfileRow) => {
    const userRoles = roleMap.get(p.id) ?? [];
    setEditForm({
      email: p.username ?? "",
      password: "",
      name: p.name,
      phone: p.phone ?? "",
      branch_id: p.branch_id ?? "",
      role: (userRoles.includes("super_admin") ? "super_admin" : "branch_user"),
    });
    setEditing(p);
  };

  return (
    <>
      <PageHeader title="Foydalanuvchilar" description="Kassirlar va adminlarni boshqarish" action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1.5" /><span className="hidden sm:inline">Yangi foydalanuvchi</span><span className="sm:hidden">Yangi</span></Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Yangi foydalanuvchi</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Email *</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Parol *</Label><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label>Ism *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Telefon</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Rol</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as "super_admin" | "branch_user" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="branch_user">Filial xodimi</SelectItem><SelectItem value="super_admin">Super admin</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Filial</Label>
                  <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{(branches ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createUser.mutate()} disabled={createUser.isPending || !form.email || !form.password || !form.name}>Yaratish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      } />
      <div className="p-3 lg:p-6 pb-24 lg:pb-6 space-y-3 lg:space-y-4">
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {(profiles ?? []).map((p) => {
              const b = p.branches as unknown as { name: string } | null;
              const rs = roleMap.get(p.id) ?? [];
              return (
                <div key={p.id} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate flex items-center gap-1.5"><UserCog className="h-3.5 w-3.5 text-primary" />{p.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1 mt-0.5"><Mail className="h-3 w-3" />{p.username}</div>
                      {p.phone && <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1"><Phone className="h-3 w-3" />{p.phone}</div>}
                      {b?.name && <div className="text-[11px] text-muted-foreground truncate">{b.name}</div>}
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[40%]">
                      {rs.map((r) => <span key={r} className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] uppercase text-primary whitespace-nowrap">{r.replace("_", " ")}</span>)}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] flex-1" onClick={() => openEdit(p as ProfileRow)}><Pencil className="h-3 w-3 mr-1" />Tahrirlash</Button>
                    {p.id !== currentUser?.id && (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] text-destructive hover:text-destructive" onClick={() => setDeleting(p as ProfileRow)}><Trash2 className="h-3 w-3" /></Button>
                    )}
                  </div>
                </div>
              );
            })}
            {(profiles ?? []).length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Foydalanuvchilar yo'q</div>}
          </div>
          <div className="hidden sm:block overflow-x-auto"><table className="w-full text-sm min-w-[780px]">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2.5 text-left">Ism</th><th className="px-4 py-2.5 text-left">Email</th><th className="px-4 py-2.5 text-left">Telefon</th><th className="px-4 py-2.5 text-left">Filial</th><th className="px-4 py-2.5 text-left">Rollar</th><th className="px-4 py-2.5 text-left">Yaratilgan</th><th className="px-4 py-2.5 text-right">Amal</th></tr>
            </thead>
            <tbody className="divide-y">
              {(profiles ?? []).map((p) => {
                const b = p.branches as unknown as { name: string } | null;
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 font-medium flex items-center gap-2"><UserCog className="h-4 w-4 text-muted-foreground" />{p.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{p.username}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.phone ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{b?.name ?? "—"}</td>
                    <td className="px-4 py-2.5"><div className="flex gap-1">{(roleMap.get(p.id) ?? []).map((r) => <span key={r} className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase text-primary">{r.replace("_", " ")}</span>)}</div></td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(p.created_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(p as ProfileRow)}><Pencil className="h-3.5 w-3.5" /></Button>
                        {p.id !== currentUser?.id && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleting(p as ProfileRow)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(profiles ?? []).length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">Foydalanuvchilar yo'q</td></tr>}
            </tbody>
          </table></div>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Foydalanuvchini tahrirlash</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Yangi parol</Label><Input type="text" placeholder="O'zgartirmaslik uchun bo'sh qoldiring" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Ism *</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Telefon</Label><Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>Rol</Label>
                <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v as "super_admin" | "branch_user" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="branch_user">Filial xodimi</SelectItem><SelectItem value="super_admin">Super admin</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Filial</Label>
                <Select value={editForm.branch_id} onValueChange={(v) => setEditForm({ ...editForm, branch_id: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{(branches ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Bekor</Button>
            <Button onClick={() => updateUser.mutate()} disabled={updateUser.isPending || !editForm.name}>Saqlash</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Foydalanuvchini o'chirish?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold">{deleting?.name}</span> ({deleting?.username}) o'chiriladi. Bu amalni bekor qilib bo'lmaydi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteUser.mutate()} disabled={deleteUser.isPending}>O'chirish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
