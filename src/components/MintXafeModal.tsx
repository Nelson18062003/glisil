import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { 
  Smartphone, 
  Building2, 
  Copy, 
  Download, 
  Upload, 
  Clock, 
  CheckCircle,
  AlertCircle,
  ArrowRight,
  ArrowLeft
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface MintXafeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMintComplete: () => void;
}

interface PaymentMethod {
  id: string;
  name: string;
  type: 'mobile' | 'bank';
  logo?: string;
  fee: number;
  accountName?: string;
  accountNumber?: string;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  { id: 'mtn_momo', name: 'MTN MoMo', type: 'mobile', fee: 0.5, accountName: 'XAFe Platform', accountNumber: '659123456' },
  { id: 'mtn_float', name: 'MTN Float', type: 'mobile', fee: 0.3, accountName: 'XAFe Platform', accountNumber: '659789012' },
  { id: 'orange_money', name: 'Orange Money', type: 'mobile', fee: 0.5, accountName: 'XAFe Platform', accountNumber: '699123456' },
  { id: 'uv_orange', name: 'UV Orange', type: 'mobile', fee: 0.4, accountName: 'XAFe Platform', accountNumber: '698987654' },
  { id: 'saramoney', name: 'Saramoney', type: 'mobile', fee: 0.6, accountName: 'XAFe Platform', accountNumber: '655123456' },
  { id: 'express_union', name: 'Express Union Mobile', type: 'mobile', fee: 0.7, accountName: 'XAFe Platform', accountNumber: '654789012' },
  { id: 'afriland_bank', name: 'Afriland First Bank', type: 'bank', fee: 1.0, accountName: 'XAFe Cameroon SARL', accountNumber: '40001-00123-12345678901-23' },
  { id: 'bicec', name: 'BICEC Bank', type: 'bank', fee: 1.0, accountName: 'XAFe Cameroon SARL', accountNumber: '12002-00456-98765432109-87' },
  { id: 'sgbc', name: 'Société Générale', type: 'bank', fee: 1.2, accountName: 'XAFe Cameroon SARL', accountNumber: '30003-00789-11111111111-11' },
  { id: 'ubc', name: 'UBC Bank', type: 'bank', fee: 1.0, accountName: 'XAFe Cameroon SARL', accountNumber: '20004-00321-22222222222-22' }
];

export const MintXafeModal = ({ isOpen, onClose, onMintComplete }: MintXafeModalProps) => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [xafeAmount, setXafeAmount] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [referenceId, setReferenceId] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [expireTime, setExpireTime] = useState<Date | null>(null);

  useEffect(() => {
    if (isOpen) {
      generateReferenceId();
      setExpireTime(new Date(Date.now() + 24 * 60 * 60 * 1000)); // 24 hours from now
    }
  }, [isOpen]);

  const generateReferenceId = () => {
    const id = 'XAFE-MINT-' + Math.floor(Math.random() * 100000).toString().padStart(5, '0');
    setReferenceId(id);
  };

  const handleClose = () => {
    setStep(1);
    setXafeAmount('');
    setSelectedMethod(null);
    setProofFile(null);
    setNotes('');
    setIsProcessing(false);
    onClose();
  };

  const handleNext = () => {
    if (step === 1 && !xafeAmount) {
      toast({
        title: "Error",
        description: "Please enter the amount of XAFe to mint",
        variant: "destructive"
      });
      return;
    }
    if (step === 2 && !selectedMethod) {
      toast({
        title: "Error", 
        description: "Please select a payment method",
        variant: "destructive"
      });
      return;
    }
    setStep(step + 1);
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Text copied to clipboard"
    });
  };

  const downloadInstructions = () => {
    const instructions = `
XAFe Minting Payment Instructions

Amount to Pay: ${Number(xafeAmount).toLocaleString()} XAF
Payment Method: ${selectedMethod?.name}
Account Name: ${selectedMethod?.accountName}
Account Number: ${selectedMethod?.accountNumber}
Reference ID: ${referenceId}
Expires: ${expireTime?.toLocaleString()}

Instructions:
1. Send exactly ${Number(xafeAmount).toLocaleString()} XAF to the account above
2. Use the Reference ID "${referenceId}" as your transaction reference
3. Take a screenshot of the payment confirmation
4. Upload the proof in the next step

Important: This payment must be completed within 24 hours.
    `;

    const blob = new Blob([instructions], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment-instructions-${referenceId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setProofFile(file);
    }
  };

  const handleSubmitMint = async () => {
    if (!proofFile) {
      toast({
        title: "Error",
        description: "Please upload proof of payment",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);

    try {
      // Import service dynamically to avoid circular imports
      const { supabase } = await import("@/integrations/supabase/client");
      const { XafeService } = await import("@/services/xafeService");
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      // Simulate verification process
      toast({
        title: "Verifying Payment...",
        description: "Please wait while we verify your payment"
      });

      // Simulate delay
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Simulate verification success
      toast({
        title: "Payment Verified",
        description: "XAFe minting in progress..."
      });

      // Simulate the mint verification process
      await XafeService.simulateMintVerification(
        user.id,
        referenceId,
        `proof_${Date.now()}.jpg`, // Mock file URL
        notes
      );

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Complete minting
      toast({
        title: "🎉 XAFe Minted Successfully!",
        description: `${Number(xafeAmount).toLocaleString()} XAFe has been added to your wallet`
      });

      onMintComplete();
      handleClose();
    } catch (error) {
      console.error('Error processing mint:', error);
      toast({
        title: "Error",
        description: "Failed to process minting request",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const renderStep1 = () => (
    <div className="space-y-6">
      <div>
        <Label htmlFor="xafe-amount" className="text-base font-semibold">
          Amount of XAFe to Mint
        </Label>
        <div className="mt-2">
          <Input
            id="xafe-amount"
            type="number"
            placeholder="10000"
            value={xafeAmount}
            onChange={(e) => setXafeAmount(e.target.value)}
            className="text-lg"
          />
          <p className="text-sm text-muted-foreground mt-1">
            Exchange Rate: 1 XAF = 1 XAFe (1:1)
          </p>
        </div>
      </div>

      {xafeAmount && (
        <Card className="bg-gradient-to-r from-xafe-green/10 to-xafe-blue/10 border-xafe-green/20">
          <CardContent className="p-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-muted-foreground">You will receive</p>
                <p className="text-2xl font-bold text-xafe-green">
                  {Number(xafeAmount).toLocaleString()} XAFe
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Payment required</p>
                <p className="text-xl font-semibold">
                  {Number(xafeAmount).toLocaleString()} XAF
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Select Payment Method</h3>
        
        {/* Mobile Money Options */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Smartphone className="h-5 w-5 text-xafe-green" />
            <h4 className="font-semibold">Mobile Money</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PAYMENT_METHODS.filter(m => m.type === 'mobile').map((method) => (
              <Card 
                key={method.id}
                className={`cursor-pointer transition-all hover:scale-105 ${
                  selectedMethod?.id === method.id 
                    ? 'border-xafe-green bg-xafe-green/10' 
                    : 'border-border hover:border-xafe-green/50'
                }`}
                onClick={() => setSelectedMethod(method)}
              >
                <CardContent className="p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold">{method.name}</p>
                      <p className="text-sm text-muted-foreground">Fee: {method.fee}%</p>
                    </div>
                    <Badge variant={selectedMethod?.id === method.id ? "default" : "secondary"}>
                      {selectedMethod?.id === method.id ? "Selected" : "Select"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Bank Options */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-5 w-5 text-xafe-blue" />
            <h4 className="font-semibold">Bank Transfer</h4>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {PAYMENT_METHODS.filter(m => m.type === 'bank').map((method) => (
              <Card 
                key={method.id}
                className={`cursor-pointer transition-all hover:scale-[1.02] ${
                  selectedMethod?.id === method.id 
                    ? 'border-xafe-blue bg-xafe-blue/10' 
                    : 'border-border hover:border-xafe-blue/50'
                }`}
                onClick={() => setSelectedMethod(method)}
              >
                <CardContent className="p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold">{method.name}</p>
                      <p className="text-sm text-muted-foreground">Fee: {method.fee}%</p>
                    </div>
                    <Badge variant={selectedMethod?.id === method.id ? "default" : "secondary"}>
                      {selectedMethod?.id === method.id ? "Selected" : "Select"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">Payment Instructions</h3>
        <p className="text-muted-foreground">
          Follow these instructions to complete your payment
        </p>
      </div>

      <Card className="bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 border-yellow-200 dark:border-yellow-800">
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex justify-between">
              <span className="font-semibold">Amount to Pay:</span>
              <span className="text-xl font-bold text-xafe-green">
                {Number(xafeAmount).toLocaleString()} XAF
              </span>
            </div>
            
            <Separator />
            
            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Payment Method:</span>
                <span className="font-semibold">{selectedMethod?.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Account Name:</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{selectedMethod?.accountName}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(selectedMethod?.accountName || '')}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span>Account Number:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{selectedMethod?.accountNumber}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(selectedMethod?.accountNumber || '')}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span>Reference ID:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-xafe-green">{referenceId}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(referenceId)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                <Clock className="h-4 w-4" />
                <span>Expires in 24 hours</span>
              </div>
              <span className="text-muted-foreground">
                {expireTime?.toLocaleString()}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={downloadInstructions}
          className="flex-1"
        >
          <Download className="h-4 w-4 mr-2" />
          Download Instructions
        </Button>
      </div>

      <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-blue-800 dark:text-blue-200">Important Instructions:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-blue-700 dark:text-blue-300">
                <li>Send exactly {Number(xafeAmount).toLocaleString()} XAF</li>
                <li>Use reference ID "{referenceId}" in your transaction</li>
                <li>Take a screenshot of payment confirmation</li>
                <li>Complete payment within 24 hours</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">Upload Proof of Payment</h3>
        <p className="text-muted-foreground">
          Upload your payment confirmation screenshot or receipt
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="proof-upload" className="text-base font-semibold">
            Payment Proof *
          </Label>
          <div className="mt-2">
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-xafe-green/50 transition-colors">
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-muted-foreground">
                  PNG, JPG, PDF up to 10MB
                </p>
              </div>
              <input
                id="proof-upload"
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => document.getElementById('proof-upload')?.click()}
              >
                Choose File
              </Button>
            </div>
            {proofFile && (
              <div className="mt-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-800 dark:text-green-200">
                    {proofFile.name}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <Label htmlFor="notes" className="text-base font-semibold">
            Additional Notes (Optional)
          </Label>
          <Textarea
            id="notes"
            placeholder="Enter transaction ID or any additional information..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-2"
          />
        </div>
      </div>

      <Card className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-yellow-800 dark:text-yellow-200">Verification Process:</p>
              <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                Your payment will be verified automatically. Once confirmed, XAFe tokens will be minted to your wallet within minutes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <div className="w-8 h-8 bg-gradient-primary rounded-lg flex items-center justify-center">
              <span className="text-white text-sm font-bold">M</span>
            </div>
            Create XAFe (Mint with XAF)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Progress Steps */}
          <div className="flex items-center justify-center space-x-4">
            {[1, 2, 3, 4].map((stepNum) => (
              <div key={stepNum} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  step >= stepNum 
                    ? 'bg-xafe-green text-white' 
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {stepNum}
                </div>
                {stepNum < 4 && (
                  <div className={`w-12 h-1 mx-2 ${
                    step > stepNum ? 'bg-xafe-green' : 'bg-muted'
                  }`} />
                )}
              </div>
            ))}
          </div>

          {/* Step Content */}
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}

          {/* Navigation Buttons */}
          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              onClick={step === 1 ? handleClose : handleBack}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>

            {step < 4 ? (
              <Button
                onClick={handleNext}
                disabled={
                  (step === 1 && !xafeAmount) ||
                  (step === 2 && !selectedMethod)
                }
                className="flex items-center gap-2"
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmitMint}
                disabled={!proofFile || isProcessing}
                className="flex items-center gap-2"
              >
                {isProcessing ? 'Processing...' : 'Submit & Mint XAFe'}
                <CheckCircle className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};