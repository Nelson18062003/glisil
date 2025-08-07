import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Copy, QrCode, CheckCircle, Clock, AlertCircle, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { CryptoService } from '@/services/cryptoService';
import QRCode from 'qrcode';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeposit: (network: string, amount: number) => Promise<void>;
}

const SUPPORTED_NETWORKS = [
  { id: 'TRC20', name: 'Tron (TRC20)', fees: '1 USDT', confirmations: 19 },
  { id: 'ERC20', name: 'Ethereum (ERC20)', fees: '15-50 USDT', confirmations: 12 },
  { id: 'BEP20', name: 'BNB Smart Chain (BEP20)', fees: '0.5 USDT', confirmations: 15 },
  { id: 'POLYGON', name: 'Polygon', fees: '0.1 USDT', confirmations: 30 },
  { id: 'ARBITRUM', name: 'Arbitrum', fees: '2-10 USDT', confirmations: 12 },
  { id: 'AVALANCHE', name: 'Avalanche C-Chain', fees: '2 USDT', confirmations: 12 },
];

export function DepositModal({ isOpen, onClose, onDeposit }: DepositModalProps) {
  const [selectedNetwork, setSelectedNetwork] = useState('TRC20');
  const [amount, setAmount] = useState('');
  const [depositAddress, setDepositAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [showQRCode, setShowQRCode] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && selectedNetwork) {
      loadDepositAddress();
      loadRecentTransactions();
    }
  }, [isOpen, selectedNetwork]);

  const loadDepositAddress = async () => {
    try {
      const address = await CryptoService.getDepositAddress(selectedNetwork);
      setDepositAddress(address);
      // Generate QR code
      await generateQRCode(address);
    } catch (error) {
      console.error('Error loading deposit address:', error);
      toast({
        title: "Error",
        description: "Unable to load deposit address",
        variant: "destructive"
      });
    }
  };

  const loadRecentTransactions = async () => {
    try {
      const transactions = await CryptoService.getRecentDeposits();
      setRecentTransactions(transactions);
    } catch (error) {
      console.error('Error loading transactions:', error);
    }
  };

  const generateQRCode = async (address: string) => {
    try {
      const url = await QRCode.toDataURL(address, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      setQrCodeDataUrl(url);
    } catch (error) {
      console.error('Error generating QR code:', error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Address copied to clipboard",
    });
  };

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid amount",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      await onDeposit(selectedNetwork, parseFloat(amount));
      toast({
        title: "Deposit initiated",
        description: "Your deposit has been recorded and will be processed upon receipt",
      });
      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description: "Error initiating deposit",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'processing':
        return <Clock className="h-4 w-4 text-orange-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'Confirmed';
      case 'processing':
        return 'Processing';
      default:
        return 'Pending';
    }
  };

  const selectedNetworkInfo = SUPPORTED_NETWORKS.find(n => n.id === selectedNetwork);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deposit XAFe</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Network Selection */}
          <div className="space-y-2">
            <Label>Blockchain network</Label>
            <Select value={selectedNetwork} onValueChange={setSelectedNetwork}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_NETWORKS.map((network) => (
                  <SelectItem key={network.id} value={network.id}>
                    <div className="flex items-center justify-between w-full">
                      <span>{network.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        Fees: {network.fees}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedNetworkInfo && (
              <div className="text-sm text-muted-foreground">
                Required confirmations: {selectedNetworkInfo.confirmations} | 
                Network fees: {selectedNetworkInfo.fees}
              </div>
            )}
          </div>

          {/* Deposit Address */}
          <div className="space-y-2">
            <Label>Deposit address</Label>
            <div className="flex items-center space-x-2">
              <Input 
                value={depositAddress} 
                readOnly 
                className="font-mono text-sm"
                placeholder="Loading address..."
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(depositAddress)}
                disabled={!depositAddress}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowQRCode(true)}
                disabled={!depositAddress}
                title="Show QR Code"
              >
                <QrCode className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <Label>Amount to deposit (XAFe)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Eg: 10000"
              min="1"
              step="0.01"
            />
            <div className="text-xs text-muted-foreground">
              Minimum amount: 1 XAFe
            </div>
          </div>

          {/* Important Notice */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
            <div className="flex items-start space-x-2">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                  Important instructions:
                </div>
                <ul className="text-yellow-700 dark:text-yellow-400 space-y-1">
                  <li>• Send XAFe only on the {selectedNetworkInfo?.name} network</li>
                  <li>• Deposits on other networks will be permanently lost</li>
                  <li>• Wait for {selectedNetworkInfo?.confirmations} confirmations for validation</li>
                  <li>• Network fees are your responsibility</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Recent Transactions */}
          {recentTransactions.length > 0 && (
            <div className="space-y-2">
              <Label>Recent deposits</Label>
              <div className="border rounded-lg p-3 max-h-32 overflow-y-auto">
                {recentTransactions.slice(0, 3).map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b last:border-b-0">
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(tx.status)}
                      <div>
                        <div className="text-sm font-medium">{tx.amount} XAFe</div>
                        <div className="text-xs text-muted-foreground">{tx.network}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={tx.status === 'confirmed' ? 'default' : 'secondary'}>
                        {getStatusText(tx.status)}
                      </Badge>
                      <div className="text-xs text-muted-foreground">
                        {tx.confirmations}/{tx.required_confirmations}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex space-x-2">
            <Button
              onClick={handleDeposit}
              disabled={isLoading || !amount || !depositAddress}
              className="flex-1"
            >
              {isLoading ? "Processing..." : "Confirm deposit"}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* QR Code Modal */}
      {showQRCode && (
        <Dialog open={showQRCode} onOpenChange={setShowQRCode}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle>Deposit QR Code</DialogTitle>
...
                  <p className="text-sm text-muted-foreground mb-4">
                    Scan this QR code to deposit USDT on the {selectedNetwork} network
                  </p>
...
                  <Copy className="h-3 w-3 mr-1" />
                  Copy address
                </Button>
              </div>
              
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-3">
                <div className="flex items-start space-x-2">
                  <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                  <div className="text-xs text-yellow-700 dark:text-yellow-400">
                    <p className="font-medium mb-1">Important:</p>
                    <ul className="space-y-1">
                      <li>• Send USDT only on {selectedNetwork}</li>
                      <li>• Make sure your wallet supports this network</li>
                      <li>• Incorrect deposits are permanently lost</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}