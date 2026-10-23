import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtMoney } from "@/lib/format";

export interface PdfReportColumn {
  header: string;
  key: string;
  align?: "left" | "right" | "center";
  money?: boolean;
  /** Numeric column rendered as a number with thousands separator. */
  number?: boolean;
  /** Percent column — averaged in the totals row. */
  percent?: boolean;
  /** Exclude this column from the totals row aggregation. */
  noTotal?: boolean;
}

export interface PdfKpi {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning" | "danger";
}

export interface PdfChart {
  title: string;
  /** Array of numeric points used to draw a sparkline / bar chart. */
  series: Array<{ label?: string; value: number }>;
  type?: "line" | "bar";
}

export interface PdfReportOptions {
  title: string;
  subtitle?: string;
  columns: PdfReportColumn[];
  rows: Array<Record<string, unknown>>;
  filename: string;
  /** Optional KPI cards rendered above the table. */
  kpis?: PdfKpi[];
  /** Optional chart rendered between KPIs and the table. */
  chart?: PdfChart;
  /** Force orientation. Default: auto — portrait on mobile/few cols. */
  orientation?: "portrait" | "landscape" | "auto";
  /** Open the PDF in a new tab after generating. Default: true. */
  openAfter?: boolean;
}

const TONE_FILL: Record<NonNullable<PdfKpi["tone"]>, [number, number, number]> = {
  default: [241, 245, 249],
  success: [220, 252, 231],
  warning: [254, 243, 199],
  danger:  [254, 226, 226],
};
const TONE_TEXT: Record<NonNullable<PdfKpi["tone"]>, [number, number, number]> = {
  default: [30, 41, 59],
  success: [22, 101, 52],
  warning: [146, 64, 14],
  danger:  [153, 27, 27],
};

function drawKpis(doc: jsPDF, kpis: PdfKpi[], x: number, y: number, width: number): number {
  if (!kpis.length) return y;
  const gap = 3;
  const perRow = width < 120 ? 2 : kpis.length <= 3 ? kpis.length : Math.min(4, kpis.length);
  const cardW = (width - gap * (perRow - 1)) / perRow;
  const cardH = 16;
  let cx = x, cy = y;
  kpis.forEach((k, i) => {
    const tone = k.tone ?? "default";
    const [fr, fg, fb] = TONE_FILL[tone];
    const [tr, tg, tb] = TONE_TEXT[tone];
    doc.setFillColor(fr, fg, fb);
    doc.roundedRect(cx, cy, cardW, cardH, 1.8, 1.8, "F");
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(100);
    doc.text(k.label, cx + 3, cy + 5);
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(tr, tg, tb);
    doc.text(k.value, cx + 3, cy + 12, { maxWidth: cardW - 6 });
    if ((i + 1) % perRow === 0) {
      cx = x;
      cy += cardH + gap;
    } else {
      cx += cardW + gap;
    }
  });
  const rows = Math.ceil(kpis.length / perRow);
  return y + rows * (cardH + gap);
}

function drawChart(doc: jsPDF, chart: PdfChart, x: number, y: number, width: number, height = 36): number {
  if (!chart.series.length) return y;
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(40);
  doc.text(chart.title, x, y + 4);
  const top = y + 7;
  const bottom = y + height;
  const innerH = bottom - top;
  doc.setDrawColor(225);
  doc.roundedRect(x, top, width, innerH, 1.2, 1.2);

  const values = chart.series.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pad = 3;
  const innerW = width - pad * 2;
  const usableH = innerH - pad * 2;

  if (chart.type === "bar") {
    const barGap = 1.5;
    const barW = (innerW - barGap * (values.length - 1)) / values.length;
    doc.setFillColor(59, 130, 246);
    values.forEach((v, i) => {
      const h = ((v - min) / range) * usableH;
      const bx = x + pad + i * (barW + barGap);
      const by = bottom - pad - h;
      doc.rect(bx, by, Math.max(barW, 0.5), Math.max(h, 0.5), "F");
    });
  } else {
    // line
    doc.setDrawColor(59, 130, 246);
    doc.setLineWidth(0.5);
    let prevX = 0, prevY = 0;
    values.forEach((v, i) => {
      const px = x + pad + (values.length === 1 ? innerW / 2 : (innerW * i) / (values.length - 1));
      const py = bottom - pad - ((v - min) / range) * usableH;
      if (i > 0) doc.line(prevX, prevY, px, py);
      prevX = px; prevY = py;
    });
    doc.setLineWidth(0.2);
  }
  return bottom + 3;
}

export function generatePdfReport(opts: PdfReportOptions) {
  const isMobile = typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 768px)").matches;
  const orientation =
    opts.orientation && opts.orientation !== "auto"
      ? opts.orientation
      : isMobile || opts.columns.length <= 4
        ? "portrait"
        : "landscape";

  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const generatedAt = new Date().toLocaleString("uz-UZ");
  const marginX = 8;
  const headerHeight = opts.subtitle ? 28 : 22;

  // ---- First page: header + KPIs + chart ----
  // Header is also drawn by didDrawPage on every page.
  let cursorY = headerHeight + 2;
  if (opts.kpis && opts.kpis.length) {
    cursorY = drawKpis(doc, opts.kpis, marginX, cursorY, pageWidth - marginX * 2) + 2;
  }
  if (opts.chart && opts.chart.series.length) {
    cursorY = drawChart(doc, opts.chart, marginX, cursorY, pageWidth - marginX * 2) + 2;
  }

  autoTable(doc, {
    startY: cursorY,
    head: [opts.columns.map((c) => c.header)],
    body: opts.rows.map((r) =>
      opts.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined || v === "") return "";
        if (c.money) return fmtMoney(Number(v));
        return String(v);
      }),
    ),
    foot: opts.rows.length > 0 ? [(() => {
      const firstNumericIdx = opts.columns.findIndex((c) => (c.money || c.percent || c.number) && !c.noTotal);
      const labelIdx = opts.columns.findIndex((c) => !(c.money || c.percent || c.number));
      return opts.columns.map((c, idx) => {
        const isNumeric = c.money || c.percent || c.number;
        if (idx === labelIdx && labelIdx !== -1 && labelIdx < firstNumericIdx) return "JAMI";
        if (!isNumeric || c.noTotal) return idx === 0 && labelIdx === -1 ? "JAMI" : "";
        const nums = opts.rows.map((r) => Number(r[c.key])).filter((n) => Number.isFinite(n));
        if (nums.length === 0) return "";
        if (c.percent) {
          const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
          return `${avg.toFixed(2)}%`;
        }
        const sum = nums.reduce((a, b) => a + b, 0);
        if (c.money) return fmtMoney(sum);
        return new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(sum);
      });
    })()] : undefined,
    styles: { fontSize: isMobile ? 7.5 : 8, cellPadding: 1.6, overflow: "linebreak" },
    headStyles: { fillColor: [33, 37, 41], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [33, 37, 41], textColor: 255, fontStyle: "bold" },
    showFoot: "lastPage",
    alternateRowStyles: { fillColor: [248, 249, 250] },
    margin: { top: headerHeight, left: marginX, right: marginX, bottom: 14 },
    tableWidth: "auto",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    columnStyles: opts.columns.reduce<Record<number, { halign: "left" | "right" | "center" }>>((acc, c, i) => {
      if (c.align) acc[i] = { halign: c.align };
      else if (c.money || c.percent || c.number) acc[i] = { halign: "right" };
      return acc;
    }, {}),
    didDrawPage: () => {
      doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(20);
      doc.text(opts.title, pageWidth / 2, 13, { align: "center" });
      if (opts.subtitle) {
        doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
        doc.text(opts.subtitle, pageWidth / 2, 19, { align: "center" });
      }
      doc.setDrawColor(220).line(marginX, 22, pageWidth - marginX, 22);

      const pageCount = doc.getNumberOfPages();
      const current = doc.getCurrentPageInfo().pageNumber;
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120);
      doc.text(generatedAt, marginX, pageHeight - 6);
      doc.text("Dasturchi: MuzaffarZed", pageWidth / 2, pageHeight - 6, { align: "center" });
      doc.text(`${current} / ${pageCount}`, pageWidth - marginX, pageHeight - 6, { align: "right" });
    },
  });

  // ---- Output (with mobile-safe fallbacks) ----
  // 1) Always trigger a download (works in all browsers).
  doc.save(opts.filename);

  if (opts.openAfter === false) return;

  // 2) Try to open in a new tab. Mobile Safari/Chrome may block popups —
  //    fall back to current-tab navigation, then to a temporary anchor click.
  try {
    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, "_blank");
    if (!win || win.closed || typeof win.closed === "undefined") {
      // Popup blocked — try navigating current tab as last resort
      const a = document.createElement("a");
      a.href = blobUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
    }
    // Revoke later so the new tab has time to load.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch {
    // Silent — file is already saved via doc.save
  }
}
