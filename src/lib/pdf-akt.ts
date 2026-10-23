import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtMoney, fmtDate } from "@/lib/format";

export interface AktRow {
  date: string;
  type: "sale" | "payment";
  description: string;
  debit: number; // sale (qarz +)
  credit: number; // payment (qarz -)
  balance: number;
}

export function generateAkt(opts: {
  shopName: string;
  customerName: string;
  customerPhone?: string | null;
  fromDate?: string;
  toDate?: string;
  rows: AktRow[];
  finalBalance: number;
}) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text("AKT-SVERKA", pageWidth / 2, 18, { align: "center" });

  doc.setFont("helvetica", "normal").setFontSize(10);
  doc.text(opts.shopName, pageWidth / 2, 25, { align: "center" });

  doc.setFontSize(11);
  doc.text(`Mijoz: ${opts.customerName}`, 14, 38);
  if (opts.customerPhone) doc.text(`Tel: ${opts.customerPhone}`, 14, 44);
  doc.text(`Sana: ${opts.fromDate ?? "—"}  —  ${opts.toDate ?? new Date().toISOString().slice(0, 10)}`, 14, 50);

  autoTable(doc, {
    startY: 58,
    head: [["#", "Sana", "Operatsiya", "Debit", "Kredit", "Qoldiq"]],
    body: opts.rows.map((r, i) => [
      String(i + 1),
      fmtDate(r.date),
      r.description,
      r.debit > 0 ? fmtMoney(r.debit) : "",
      r.credit > 0 ? fmtMoney(r.credit) : "",
      fmtMoney(r.balance),
    ]),
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [40, 40, 40] },
    columnStyles: {
      0: { cellWidth: 10 },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  doc.setFont("helvetica", "bold").setFontSize(12);
  doc.text(`Joriy qarz: ${fmtMoney(opts.finalBalance)}`, pageWidth - 14, finalY, { align: "right" });

  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(40);
  doc.text("Sotuvchi imzosi: ____________________", 14, finalY + 25);
  doc.text("Mijoz imzosi: ____________________", pageWidth - 14, finalY + 25, { align: "right" });

  doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(150);
  doc.text("Dasturchi: MuzaffarZed", pageWidth / 2, finalY + 33, { align: "center" });

  doc.save(`akt-sverka-${opts.customerName.replace(/[^a-z0-9]/gi, "_")}-${new Date().toISOString().slice(0, 10)}.pdf`);
}