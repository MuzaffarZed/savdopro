import { fmtMoney, fmtDate } from "./format";

export interface ReceiptData {
  shop: string;
  branch?: string;
  date: Date;
  cashier?: string;
  customer?: string;
  items: Array<{ name: string; qty: number; price: number; unit?: string }>;
  subtotal?: number;
  discount?: number;
  total: number;
  paid: number;
  debt: number;
  method: string;
  receiptNo?: string;
}

export function printReceipt(data: ReceiptData) {
  const w = window.open("", "_blank", "width=380,height=600");
  if (!w) return;
  const rows = data.items.map((i) => `
    <tr>
      <td colspan="3" style="padding-top:4px">${escapeHtml(i.name)}</td>
    </tr>
    <tr>
      <td>${i.qty}${i.unit ? ` ${escapeHtml(i.unit)}` : ""} × ${fmtMoney(i.price)}</td>
      <td></td>
      <td style="text-align:right">${fmtMoney(i.qty * i.price)}</td>
    </tr>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Chek</title>
    <style>
      @page { size: 80mm auto; margin: 4mm; }
      body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0; }
      h2 { text-align:center; margin: 4px 0; font-size: 14px; }
      .meta, .foot { text-align:center; font-size: 11px; }
      hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; }
      .totals td { padding-top: 2px; }
      .totals .lbl { color: #000; }
      .totals .val { text-align: right; font-weight: bold; }
    </style></head><body>
    <h2>${escapeHtml(data.shop)}</h2>
    ${data.branch ? `<div class="meta">${escapeHtml(data.branch)}</div>` : ""}
    <div class="meta">${fmtDate(data.date)}</div>
    ${data.receiptNo ? `<div class="meta">№ ${escapeHtml(data.receiptNo)}</div>` : ""}
    ${data.cashier ? `<div class="meta">Sotuvchi: ${escapeHtml(data.cashier)}</div>` : ""}
    ${data.customer ? `<div class="meta">Mijoz: ${escapeHtml(data.customer)}</div>` : ""}
    <hr/>
    <table>${rows}</table>
    <hr/>
    <table class="totals">
      ${data.discount && data.discount > 0 ? `
        <tr><td class="lbl">Oraliq summa</td><td class="val">${fmtMoney(data.subtotal ?? (data.total + data.discount))}</td></tr>
        <tr><td class="lbl">Chegirma</td><td class="val">-${fmtMoney(data.discount)}</td></tr>
      ` : ""}
      <tr><td class="lbl">JAMI</td><td class="val">${fmtMoney(data.total)}</td></tr>
      <tr><td class="lbl">To'landi (${escapeHtml(data.method)})</td><td class="val">${fmtMoney(data.paid)}</td></tr>
      ${data.debt > 0 ? `<tr><td class="lbl">QARZ</td><td class="val">${fmtMoney(data.debt)}</td></tr>` : ""}
    </table>
    <hr/>
    <div class="foot">Xaridingiz uchun rahmat!</div>
    <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300);}</script>
  </body></html>`);
  w.document.close();
}

export interface DebtPaymentReceiptData {
  shop: string;
  branch?: string;
  date: Date;
  cashier?: string;
  customer: string;
  amount: number;
  debtCleared: number;
  remainingDebt: number;
  method: string;
  receiptNo?: string;
  note?: string;
}

export function printDebtPaymentReceipt(data: DebtPaymentReceiptData) {
  const w = window.open("", "_blank", "width=380,height=600");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Qarz to'lovi cheki</title>
    <style>
      @page { size: 80mm auto; margin: 4mm; }
      body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0; }
      h2 { text-align:center; margin: 4px 0; font-size: 14px; }
      .meta, .foot { text-align:center; font-size: 11px; }
      hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; }
      .totals td { padding-top: 3px; }
      .totals .lbl { color: #000; }
      .totals .val { text-align: right; font-weight: bold; }
    </style></head><body>
    <h2>${escapeHtml(data.shop)}</h2>
    <div class="meta">QARZ TO'LOVI KVITANSIYASI</div>
    ${data.branch ? `<div class="meta">${escapeHtml(data.branch)}</div>` : ""}
    <div class="meta">${fmtDate(data.date)}</div>
    ${data.receiptNo ? `<div class="meta">№ ${escapeHtml(data.receiptNo)}</div>` : ""}
    ${data.cashier ? `<div class="meta">Kassir: ${escapeHtml(data.cashier)}</div>` : ""}
    <div class="meta">Mijoz: <strong>${escapeHtml(data.customer)}</strong></div>
    <hr/>
    <table class="totals">
      <tr><td class="lbl">To'langan summa (${escapeHtml(data.method)}):</td><td class="val">${fmtMoney(data.amount)}</td></tr>
      <tr><td class="lbl">Qoplangan qarz:</td><td class="val">${fmtMoney(data.debtCleared)}</td></tr>
      <tr><td class="lbl">QOLGAN QARZ:</td><td class="val">${fmtMoney(data.remainingDebt)}</td></tr>
      ${data.note ? `<tr><td colspan="2" style="font-size:10px;padding-top:4px">Izoh: ${escapeHtml(data.note)}</td></tr>` : ""}
    </table>
    <hr/>
    <div class="foot">To'lovingiz uchun rahmat!</div>
    <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300);}</script>
  </body></html>`);
  w.document.close();
}

export interface AktSverkaItem {
  date: string;
  type: "sale" | "payment";
  title: string;
  docNo?: string;
  debit: number;
  credit: number;
  balance: number;
}

export function printAktSverka(customerName: string, items: AktSverkaItem[], finalBalance: number, dateStr: string) {
  const w = window.open("", "_blank", "width=600,height=800");
  if (!w) return;
  const rows = items.map((it) => `
    <tr>
      <td style="padding:4px;border-bottom:1px solid #ddd;font-size:11px">${escapeHtml(it.date)}</td>
      <td style="padding:4px;border-bottom:1px solid #ddd;font-size:11px">${escapeHtml(it.title)}</td>
      <td style="padding:4px;border-bottom:1px solid #ddd;font-size:11px;text-align:right">${it.debit > 0 ? fmtMoney(it.debit) : "—"}</td>
      <td style="padding:4px;border-bottom:1px solid #ddd;font-size:11px;text-align:right">${it.credit > 0 ? fmtMoney(it.credit) : "—"}</td>
      <td style="padding:4px;border-bottom:1px solid #ddd;font-size:11px;text-align:right;font-weight:bold">${fmtMoney(it.balance)}</td>
    </tr>
  `).join("");

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Akt Sverka — ${escapeHtml(customerName)}</title>
    <style>
      @page { size: auto; margin: 10mm; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px; color: #111; margin: 0; padding: 12px; }
      h2 { margin: 0 0 4px 0; font-size: 18px; }
      .meta { font-size: 12px; color: #555; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th { background: #f3f4f6; text-align: left; padding: 6px 4px; font-size: 11px; border-bottom: 2px solid #ccc; }
      .total-box { margin-top: 16px; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; text-align: right; }
      .total-box strong { font-size: 14px; }
    </style></head><body>
    <h2>SavdoPro — O'zaro hisob-kitob solishtirma dalolatnomasi (Akt Sverka)</h2>
    <div class="meta">Mijoz: <strong>${escapeHtml(customerName)}</strong> | Holati: ${escapeHtml(dateStr)}</div>
    <table>
      <thead>
        <tr>
          <th>Sana</th>
          <th>Operatsiya turi</th>
          <th style="text-align:right">Kirim (Qarz +)</th>
          <th style="text-align:right">Chiqim (To'lov -)</th>
          <th style="text-align:right">Qoldiq qarz</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total-box">
      Hozirgi qarz qoldig'i: <strong>${fmtMoney(finalBalance)}</strong>
    </div>
    <div style="margin-top:24px;font-size:11px;color:#777;text-align:center">
      SavdoPro avtomatlashtirilgan savdo tizimi orqali shakllantirildi
    </div>
    <script>window.onload=()=>{window.print();}</script>
  </body></html>`);
  w.document.close();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}