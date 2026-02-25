import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileDown, Plus, Trash2 } from "lucide-react";
import { generateInvoicePdf, generateSampleInvoice, InvoiceItem } from "@/utils/generateInvoicePdf";
import { Link } from "react-router-dom";

export default function Invoice() {
  const [invoiceNumber, setInvoiceNumber] = useState("INV-2025-001");
  const [date, setDate] = useState("25/02/2025");
  const [clientName, setClientName] = useState("Jean Dupont");
  const [clientEmail, setClientEmail] = useState("jean.dupont@email.com");
  const [taxRate, setTaxRate] = useState(19.25);
  const [paymentMethod, setPaymentMethod] = useState("MTN Mobile Money");
  const [items, setItems] = useState<InvoiceItem[]>([
    { description: "Conversion XAF → XAFe", unitPrice: 500_000, quantity: 1, total: 500_000 },
    { description: "Frais de service", unitPrice: 2_500, quantity: 1, total: 2_500 },
    { description: "Frais réseau blockchain", unitPrice: 1_000, quantity: 1, total: 1_000 },
  ]);

  const updateItem = (index: number, field: keyof InvoiceItem, value: string | number) => {
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index], [field]: value };
      if (field === "unitPrice" || field === "quantity") {
        item.total = item.unitPrice * item.quantity;
      }
      updated[index] = item;
      return updated;
    });
  };

  const addItem = () => {
    setItems((prev) => [...prev, { description: "", unitPrice: 0, quantity: 1, total: 0 }]);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  const formatXAF = (n: number) =>
    n.toLocaleString("fr-FR", { minimumFractionDigits: n % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 }) + " XAF";

  const handleDownload = () => {
    generateInvoicePdf({ invoiceNumber, date, clientName, clientEmail, items, taxRate, paymentMethod });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-amber-400">Facture PDF</h1>
            <p className="text-gray-400 text-sm mt-1">Générez une facture PDF nette et vectorielle</p>
          </div>
          <Link to="/">
            <Button variant="outline" className="border-gray-700 text-gray-300 hover:bg-gray-800">
              Retour
            </Button>
          </Link>
        </div>

        {/* Quick download */}
        <Card className="bg-gray-900/50 border-gray-800">
          <CardContent className="pt-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <p className="text-gray-300 text-sm">
              Télécharger directement la facture exemple affichée dans l'aperçu.
            </p>
            <Button onClick={generateSampleInvoice} className="bg-amber-500 hover:bg-amber-600 text-black font-semibold gap-2 shrink-0">
              <FileDown className="w-4 h-4" />
              Télécharger l'exemple
            </Button>
          </CardContent>
        </Card>

        {/* Form */}
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader>
            <CardTitle className="text-lg text-white">Personnaliser la facture</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Info fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-gray-400">N° Facture</Label>
                <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="bg-gray-800 border-gray-700 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-400">Date</Label>
                <Input value={date} onChange={(e) => setDate(e.target.value)} className="bg-gray-800 border-gray-700 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-400">Nom du client</Label>
                <Input value={clientName} onChange={(e) => setClientName(e.target.value)} className="bg-gray-800 border-gray-700 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-400">Email</Label>
                <Input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className="bg-gray-800 border-gray-700 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-400">Taux TVA (%)</Label>
                <Input type="number" step="0.01" value={taxRate} onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)} className="bg-gray-800 border-gray-700 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-400">Moyen de paiement</Label>
                <Input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="bg-gray-800 border-gray-700 text-white" />
              </div>
            </div>

            {/* Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-gray-400 text-base">Articles</Label>
                <Button variant="ghost" size="sm" onClick={addItem} className="text-amber-400 hover:text-amber-300 gap-1">
                  <Plus className="w-4 h-4" /> Ajouter
                </Button>
              </div>

              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                  <div className="space-y-1">
                    {i === 0 && <Label className="text-gray-500 text-xs">Description</Label>}
                    <Input value={item.description} onChange={(e) => updateItem(i, "description", e.target.value)} className="bg-gray-800 border-gray-700 text-white text-sm" />
                  </div>
                  <div className="space-y-1 w-28">
                    {i === 0 && <Label className="text-gray-500 text-xs">Prix unitaire</Label>}
                    <Input type="number" value={item.unitPrice} onChange={(e) => updateItem(i, "unitPrice", parseFloat(e.target.value) || 0)} className="bg-gray-800 border-gray-700 text-white text-sm" />
                  </div>
                  <div className="space-y-1 w-16">
                    {i === 0 && <Label className="text-gray-500 text-xs">Qté</Label>}
                    <Input type="number" value={item.quantity} onChange={(e) => updateItem(i, "quantity", parseInt(e.target.value) || 0)} className="bg-gray-800 border-gray-700 text-white text-sm" />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeItem(i)} className="text-red-400 hover:text-red-300 h-9 w-9">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="border-t border-gray-800 pt-4 space-y-2 text-right text-sm">
              <p className="text-gray-400">Sous-total: <span className="text-white font-medium">{formatXAF(subtotal)}</span></p>
              <p className="text-gray-400">TVA ({taxRate}%): <span className="text-white font-medium">{formatXAF(tax)}</span></p>
              <p className="text-lg font-bold text-amber-400">Total: {formatXAF(total)}</p>
            </div>

            {/* Download button */}
            <div className="flex justify-end pt-2">
              <Button onClick={handleDownload} className="bg-amber-500 hover:bg-amber-600 text-black font-semibold gap-2 px-8">
                <FileDown className="w-5 h-5" />
                Générer le PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
