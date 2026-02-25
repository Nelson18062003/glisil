import jsPDF from "jspdf";

export interface InvoiceItem {
  description: string;
  unitPrice: number;
  quantity: number;
  total: number;
}

export interface InvoiceData {
  invoiceNumber: string;
  date: string;
  clientName: string;
  clientEmail: string;
  items: InvoiceItem[];
  taxRate: number; // e.g. 19.25
  paymentMethod: string;
}

function formatXAF(amount: number): string {
  return amount.toLocaleString("fr-FR", {
    minimumFractionDigits: amount % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  }) + " XAF";
}

export function generateInvoicePdf(data: InvoiceData): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginLeft = 20;
  const marginRight = 20;
  const contentWidth = pageWidth - marginLeft - marginRight;

  // ── Colors ──
  const orange = [230, 160, 30] as const;
  const darkText = [30, 30, 30] as const;
  const grayText = [100, 100, 100] as const;
  const lightGray = [245, 245, 245] as const;
  const headerBg = [40, 40, 40] as const;
  const white = [255, 255, 255] as const;

  let y = 20;

  // ── Header: XAFE Logo text ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(...orange);
  doc.text("XAFE", marginLeft, y + 8);

  // Orange accent line
  doc.setDrawColor(...orange);
  doc.setLineWidth(0.8);
  doc.line(marginLeft, y + 13, marginLeft + 30, y + 13);

  // ── Title: FACTURE ──
  doc.setFontSize(22);
  doc.setTextColor(...darkText);
  doc.text("FACTURE", pageWidth - marginRight, y + 8, { align: "right" });

  y += 25;

  // ── Invoice info ──
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grayText);
  doc.text("Facture N°:", marginLeft, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...darkText);
  doc.text(data.invoiceNumber, marginLeft + 28, y);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grayText);
  doc.text("Date:", pageWidth - marginRight - 40, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...darkText);
  doc.text(data.date, pageWidth - marginRight, y, { align: "right" });

  y += 10;

  // ── Client info ──
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grayText);
  doc.text("Client:", marginLeft, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...darkText);
  doc.text(data.clientName, marginLeft + 18, y);

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...grayText);
  doc.text("Email:", marginLeft, y);
  doc.setTextColor(...darkText);
  doc.text(data.clientEmail, marginLeft + 18, y);

  y += 15;

  // ── Table ──
  const colWidths = [contentWidth * 0.42, contentWidth * 0.22, contentWidth * 0.14, contentWidth * 0.22];
  const colX = [
    marginLeft,
    marginLeft + colWidths[0],
    marginLeft + colWidths[0] + colWidths[1],
    marginLeft + colWidths[0] + colWidths[1] + colWidths[2],
  ];

  // Table header
  const headerHeight = 10;
  doc.setFillColor(...headerBg);
  doc.roundedRect(marginLeft, y, contentWidth, headerHeight, 2, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...white);
  const headerY = y + 7;
  doc.text("Description", colX[0] + 4, headerY);
  doc.text("Prix unitaire", colX[1] + 4, headerY);
  doc.text("Quantité", colX[2] + 4, headerY);
  doc.text("Total", colX[3] + colWidths[3] - 4, headerY, { align: "right" });

  y += headerHeight;

  // Table rows
  doc.setFontSize(9);
  const rowHeight = 10;
  data.items.forEach((item, index) => {
    if (index % 2 === 0) {
      doc.setFillColor(...lightGray);
      doc.rect(marginLeft, y, contentWidth, rowHeight, "F");
    }

    const rowY = y + 7;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...darkText);
    doc.text(item.description, colX[0] + 4, rowY);
    doc.text(formatXAF(item.unitPrice), colX[1] + 4, rowY);
    doc.setTextColor(...grayText);
    doc.text(String(item.quantity), colX[2] + colWidths[2] / 2, rowY, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...darkText);
    doc.text(formatXAF(item.total), colX[3] + colWidths[3] - 4, rowY, { align: "right" });

    y += rowHeight;
  });

  // Bottom line of table
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(marginLeft, y, marginLeft + contentWidth, y);

  y += 8;

  // ── Totals section ──
  const totalsX = colX[2];
  const totalsValueX = colX[3] + colWidths[3] - 4;

  const subtotal = data.items.reduce((sum, item) => sum + item.total, 0);
  const taxAmount = subtotal * (data.taxRate / 100);
  const total = subtotal + taxAmount;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...grayText);
  doc.text("Sous-total:", totalsX, y);
  doc.setTextColor(...darkText);
  doc.text(formatXAF(subtotal), totalsValueX, y, { align: "right" });

  y += 7;
  doc.setTextColor(...grayText);
  doc.text(`TVA (${data.taxRate}%):`, totalsX, y);
  doc.setTextColor(...darkText);
  doc.text(formatXAF(taxAmount), totalsValueX, y, { align: "right" });

  y += 10;

  // Total highlight box
  const totalBoxWidth = contentWidth * 0.36 + 8;
  const totalBoxX = totalsValueX - totalBoxWidth + 4;
  doc.setFillColor(...orange);
  doc.roundedRect(totalBoxX, y - 6, totalBoxWidth, 12, 2, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...white);
  doc.text("Total:", totalBoxX + 6, y + 2);
  doc.text(formatXAF(total), totalsValueX, y + 2, { align: "right" });

  y += 25;

  // ── Footer ──
  doc.setDrawColor(...orange);
  doc.setLineWidth(0.5);
  doc.line(marginLeft, y, marginLeft + contentWidth, y);

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...grayText);
  doc.text(`Paiement effectué via ${data.paymentMethod}`, marginLeft, y);

  y += 6;
  doc.setFont("helvetica", "italic");
  doc.setTextColor(...orange);
  doc.text("Merci pour votre confiance !", marginLeft, y);

  // ── Save ──
  doc.save(`facture-${data.invoiceNumber}.pdf`);
}

/** Generates the sample invoice shown in the app mockup */
export function generateSampleInvoice(): void {
  generateInvoicePdf({
    invoiceNumber: "INV-2025-001",
    date: "25/02/2025",
    clientName: "Jean Dupont",
    clientEmail: "jean.dupont@email.com",
    items: [
      {
        description: "Conversion XAF → XAFe",
        unitPrice: 500_000,
        quantity: 1,
        total: 500_000,
      },
      {
        description: "Frais de service",
        unitPrice: 2_500,
        quantity: 1,
        total: 2_500,
      },
      {
        description: "Frais réseau blockchain",
        unitPrice: 1_000,
        quantity: 1,
        total: 1_000,
      },
    ],
    taxRate: 19.25,
    paymentMethod: "MTN Mobile Money",
  });
}
