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
        title: "Erreur",
        description: "Impossible de charger l'adresse de dépôt",
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
      title: "Copié",
      description: "Adresse copiée dans le presse-papier",
    });
  };

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Erreur",
        description: "Veuillez entrer un montant valide",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      await onDeposit(selectedNetwork, parseFloat(amount));
      toast({
        title: "Dépôt initié",
        description: "Votre dépôt a été enregistré et sera traité dès réception",
      });
      onClose();
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Erreur lors de l'initiation du dépôt",
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
        return 'Confirmé';
      case 'processing':
        return 'En traitement';
      default:
        return 'En attente';
    }
  };

  const selectedNetworkInfo = SUPPORTED_NETWORKS.find(n => n.id === selectedNetwork);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Déposer XAFe</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Network Selection */}
          <div className="space-y-2">
            <Label>Réseau blockchain</Label>
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
                        Frais: {network.fees}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedNetworkInfo && (
              <div className="text-sm text-muted-foreground">
                Confirmations requises: {selectedNetworkInfo.confirmations} | 
                Frais réseau: {selectedNetworkInfo.fees}
              </div>
            )}
          </div>

          {/* Deposit Address */}
          <div className="space-y-2">
            <Label>Adresse de dépôt</Label>
            <div className="flex items-center space-x-2">
              <Input 
                value={depositAddress} 
                readOnly 
                className="font-mono text-sm"
                placeholder="Chargement de l'adresse..."
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
                title="Afficher le QR Code"
              >
                <QrCode className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <Label>Montant à déposer (XAFe)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Ex: 10000"
              min="1"
              step="0.01"
            />
            <div className="text-xs text-muted-foreground">
              Montant minimum: 1 XAFe
            </div>
          </div>

          {/* Important Notice */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
            <div className="flex items-start space-x-2">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                  Instructions importantes:
                </div>
                <ul className="text-yellow-700 dark:text-yellow-400 space-y-1">
                  <li>• Envoyez uniquement des XAFe sur le réseau {selectedNetworkInfo?.name}</li>
                  <li>• Les dépôts sur d'autres réseaux seront perdus définitivement</li>
                  <li>• Attendez {selectedNetworkInfo?.confirmations} confirmations pour la validation</li>
                  <li>• Les frais de réseau sont à votre charge</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Recent Transactions */}
          {recentTransactions.length > 0 && (
            <div className="space-y-2">
              <Label>Dépôts récents</Label>
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
              {isLoading ? "Traitement..." : "Confirmer le dépôt"}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Annuler
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
                <DialogTitle>QR Code de dépôt</DialogTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowQRCode(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-4">
                  Scannez ce QR code pour déposer des USDT sur le réseau {selectedNetwork}
                </p>
                
                {qrCodeDataUrl && (
                  <div className="flex justify-center mb-4">
                    <img 
                      src={qrCodeDataUrl} 
                      alt="QR Code" 
                      className="border rounded-lg"
                    />
                  </div>
                )}
                
                <div className="bg-gray-50 dark:bg-gray-900 border rounded-lg p-3">
                  <p className="text-xs font-mono break-all text-center">
                    {depositAddress}
                  </p>
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(depositAddress)}
                  className="mt-2"
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copier l'adresse
                </Button>
              </div>
              
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-3">
                <div className="flex items-start space-x-2">
                  <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                  <div className="text-xs text-yellow-700 dark:text-yellow-400">
                    <p className="font-medium mb-1">Important:</p>
                    <ul className="space-y-1">
                      <li>• Envoyez uniquement des USDT sur {selectedNetwork}</li>
                      <li>• Vérifiez que votre wallet supporte ce réseau</li>
                      <li>• Les dépôts incorrects sont perdus définitivement</li>
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