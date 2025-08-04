import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, Send, Clock, CheckCircle, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';

const WITHDRAWAL_NETWORKS = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    symbol: 'ETH',
    type: 'ERC20',
    color: 'bg-blue-500',
    fees: '10 XAFe',
    minAmount: '50',
    time: '5-15 min',
    icon: '⟠'
  },
  {
    id: 'tron',
    name: 'Tron',
    symbol: 'TRX',
    type: 'TRC20',
    color: 'bg-red-500',
    fees: '2 XAFe',
    minAmount: '20',
    time: '1-3 min',
    icon: '⬡'
  },
  {
    id: 'bsc',
    name: 'BNB Smart Chain',
    symbol: 'BNB',
    type: 'BEP20',
    color: 'bg-yellow-500',
    fees: '1 XAFe',
    minAmount: '10',
    time: '1-5 min',
    icon: '◆'
  },
  {
    id: 'polygon',
    name: 'Polygon',
    symbol: 'MATIC',
    type: 'ERC20',
    color: 'bg-purple-500',
    fees: '0.5 XAFe',
    minAmount: '5',
    time: '1-3 min',
    icon: '⬢'
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    symbol: 'ARB',
    type: 'ERC20',
    color: 'bg-sky-500',
    fees: '1.5 XAFe',
    minAmount: '10',
    time: '1-5 min',
    icon: '△'
  },
  {
    id: 'avalanche',
    name: 'Avalanche',
    symbol: 'AVAX',
    type: 'ERC20',
    color: 'bg-red-600',
    fees: '2 XAFe',
    minAmount: '15',
    time: '1-3 min',
    icon: '▲'
  }
];

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  balance?: number;
}

export const WithdrawModal: React.FC<WithdrawModalProps> = ({ 
  isOpen, 
  onClose, 
  balance = 0 
}) => {
  const [selectedNetwork, setSelectedNetwork] = useState('ethereum');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { t } = useLanguage();

  const selectedNetworkData = WITHDRAWAL_NETWORKS.find(n => n.id === selectedNetwork);
  const withdrawalFee = parseFloat(selectedNetworkData?.fees.split(' ')[0] || '0');
  const minAmount = parseFloat(selectedNetworkData?.minAmount || '0');
  const maxAmount = balance;
  const netAmount = Math.max(0, parseFloat(amount || '0') - withdrawalFee);

  const isValidAmount = () => {
    const amountNum = parseFloat(amount || '0');
    return amountNum >= minAmount && amountNum <= maxAmount && amountNum > withdrawalFee;
  };

  const isValidAddress = () => {
    if (!address) return false;
    
    // Basic address validation based on network
    switch (selectedNetwork) {
      case 'ethereum':
      case 'bsc':
      case 'polygon':
      case 'arbitrum':
      case 'avalanche':
        return /^0x[a-fA-F0-9]{40}$/.test(address);
      case 'tron':
        return /^T[a-zA-Z0-9]{33}$/.test(address);
      default:
        return false;
    }
  };

  const simulateWithdraw = () => {
    if (!isValidAmount() || !isValidAddress()) {
      toast({
        title: t('language') === 'fr' ? 'Erreur' : 'Error',
        description: t('language') === 'fr' 
          ? 'Veuillez vérifier le montant et l\'adresse' 
          : 'Please check amount and address',
        variant: 'destructive'
      });
      return;
    }

    setIsProcessing(true);
    
    // Simulate processing time
    setTimeout(() => {
      setIsProcessing(false);
      toast({
        title: t('language') === 'fr' ? 'Retrait initié' : 'Withdrawal Initiated',
        description: t('language') === 'fr' 
          ? 'Votre retrait est en cours de traitement' 
          : 'Your withdrawal is being processed',
      });
      onClose();
    }, 2000);
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setAddress(text);
      toast({
        title: t('language') === 'fr' ? 'Collé!' : 'Pasted!',
        description: t('language') === 'fr' ? 'Adresse collée depuis le presse-papiers' : 'Address pasted from clipboard',
      });
    } catch (err) {
      toast({
        title: t('language') === 'fr' ? 'Erreur' : 'Error',
        description: t('language') === 'fr' ? 'Impossible de coller' : 'Unable to paste',
        variant: 'destructive'
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-bold">
            {t('language') === 'fr' ? 'Retirer XAFe' : 'Withdraw XAFe'}
          </DialogTitle>
        </DialogHeader>

        <div className="mb-4">
          <div className="bg-primary/10 p-4 rounded-lg border border-primary/20">
            <p className="text-sm text-muted-foreground mb-1">
              {t('language') === 'fr' ? 'Solde disponible' : 'Available Balance'}
            </p>
            <p className="text-2xl font-heading font-bold text-primary">
              {balance.toLocaleString()} XAFe
            </p>
          </div>
        </div>

        <Tabs value={selectedNetwork} onValueChange={setSelectedNetwork} className="w-full">
          <div className="mb-6">
            <Label className="text-base font-semibold mb-3 block">
              {t('language') === 'fr' ? 'Choisir un réseau de retrait' : 'Choose Withdrawal Network'}
            </Label>
            <TabsList className="grid grid-cols-3 gap-1 h-auto p-1">
              {WITHDRAWAL_NETWORKS.map((network) => (
                <TabsTrigger
                  key={network.id}
                  value={network.id}
                  className="flex flex-col gap-1 h-20 data-[state=active]:bg-primary/10"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{network.icon}</span>
                    <span className="font-semibold text-xs">{network.type}</span>
                  </div>
                  <span className="text-xs font-medium">{network.name}</span>
                  <Badge variant="secondary" className="text-xs px-1 py-0">
                    {network.fees}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {WITHDRAWAL_NETWORKS.map((network) => (
            <TabsContent key={network.id} value={network.id} className="space-y-6">
              {/* Network Info */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 ${network.color} rounded-full flex items-center justify-center text-white font-bold`}>
                        {network.icon}
                      </div>
                      <div>
                        <h3 className="font-heading font-bold">{network.name}</h3>
                        <p className="text-sm text-muted-foreground">{network.type} Network</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">
                        {t('language') === 'fr' ? 'Frais' : 'Fee'}
                      </p>
                      <p className="font-semibold text-red-600">{network.fees}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t('language') === 'fr' ? 'Minimum' : 'Minimum'}
                      </p>
                      <p className="font-semibold">{network.minAmount} XAFe</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t('language') === 'fr' ? 'Temps' : 'Time'}
                      </p>
                      <p className="font-semibold">{network.time}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Withdrawal Form */}
              <Card>
                <CardContent className="p-4 space-y-4">
                  <h4 className="font-heading font-semibold">
                    {t('language') === 'fr' ? 'Détails du retrait' : 'Withdrawal Details'}
                  </h4>
                  
                  {/* Amount Input */}
                  <div>
                    <Label>
                      {t('language') === 'fr' ? 'Montant à retirer' : 'Amount to Withdraw'}
                    </Label>
                    <div className="relative mt-1">
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="pr-16"
                      />
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <span className="text-sm font-semibold text-muted-foreground">XAFe</span>
                      </div>
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                      <span>
                        {t('language') === 'fr' ? 'Min:' : 'Min:'} {network.minAmount} XAFe
                      </span>
                      <button
                        type="button"
                        onClick={() => setAmount(balance.toString())}
                        className="text-primary hover:underline"
                      >
                        {t('language') === 'fr' ? 'Max:' : 'Max:'} {balance.toLocaleString()} XAFe
                      </button>
                    </div>
                  </div>

                  {/* Destination Address */}
                  <div>
                    <Label>
                      {t('language') === 'fr' ? 'Adresse de destination' : 'Destination Address'}
                    </Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        placeholder={
                          network.id === 'tron' 
                            ? 'T...' 
                            : '0x...'
                        }
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="font-mono text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={pasteFromClipboard}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    {address && !isValidAddress() && (
                      <p className="text-xs text-red-600 mt-1">
                        {t('language') === 'fr' ? 'Adresse invalide' : 'Invalid address'}
                      </p>
                    )}
                  </div>

                  {/* Transaction Summary */}
                  {amount && parseFloat(amount) > 0 && (
                    <div className="bg-secondary/10 p-4 rounded-lg border">
                      <h5 className="font-semibold mb-2">
                        {t('language') === 'fr' ? 'Résumé de la transaction' : 'Transaction Summary'}
                      </h5>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>{t('language') === 'fr' ? 'Montant' : 'Amount'}:</span>
                          <span className="font-semibold">{amount} XAFe</span>
                        </div>
                        <div className="flex justify-between text-red-600">
                          <span>{t('language') === 'fr' ? 'Frais réseau' : 'Network Fee'}:</span>
                          <span className="font-semibold">-{network.fees}</span>
                        </div>
                        <hr className="border-secondary" />
                        <div className="flex justify-between font-bold">
                          <span>{t('language') === 'fr' ? 'Vous recevrez' : 'You will receive'}:</span>
                          <span className="text-primary">{netAmount.toFixed(2)} XAFe</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warning */}
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <div className="text-sm text-red-700">
                        <p className="font-semibold">
                          {t('language') === 'fr' ? 'Attention:' : 'Warning:'}
                        </p>
                        <p>
                          {t('language') === 'fr' 
                            ? 'Vérifiez soigneusement l\'adresse. Les transactions sont irréversibles.'
                            : 'Double-check the address carefully. Transactions are irreversible.'
                          }
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <Button 
                    onClick={simulateWithdraw}
                    disabled={isProcessing || !isValidAmount() || !isValidAddress()}
                    className="w-full"
                    size="lg"
                  >
                    {isProcessing ? (
                      <>
                        <Clock className="h-4 w-4 mr-2 animate-spin" />
                        {t('language') === 'fr' ? 'Traitement...' : 'Processing...'}
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        {t('language') === 'fr' ? 'Confirmer le retrait' : 'Confirm Withdrawal'}
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};