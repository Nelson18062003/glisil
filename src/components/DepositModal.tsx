import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Copy, QrCode, ExternalLink, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';

const BLOCKCHAIN_NETWORKS = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    symbol: 'ETH',
    type: 'ERC20',
    color: 'bg-blue-500',
    fees: '~$5-15',
    time: '5-15 min',
    icon: '⟠'
  },
  {
    id: 'tron',
    name: 'Tron',
    symbol: 'TRX',
    type: 'TRC20',
    color: 'bg-red-500',
    fees: '~$1-3',
    time: '1-3 min',
    icon: '⬡'
  },
  {
    id: 'bsc',
    name: 'BNB Smart Chain',
    symbol: 'BNB',
    type: 'BEP20',
    color: 'bg-yellow-500',
    fees: '~$0.5-1',
    time: '1-5 min',
    icon: '◆'
  },
  {
    id: 'polygon',
    name: 'Polygon',
    symbol: 'MATIC',
    type: 'ERC20',
    color: 'bg-purple-500',
    fees: '~$0.01-0.1',
    time: '1-3 min',
    icon: '⬢'
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    symbol: 'ARB',
    type: 'ERC20',
    color: 'bg-sky-500',
    fees: '~$0.1-1',
    time: '1-5 min',
    icon: '△'
  },
  {
    id: 'avalanche',
    name: 'Avalanche',
    symbol: 'AVAX',
    type: 'ERC20',
    color: 'bg-red-600',
    fees: '~$0.5-2',
    time: '1-3 min',
    icon: '▲'
  }
];

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddresses?: Record<string, string>;
}

export const DepositModal: React.FC<DepositModalProps> = ({ 
  isOpen, 
  onClose, 
  walletAddresses = {} 
}) => {
  const [selectedNetwork, setSelectedNetwork] = useState('ethereum');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { t } = useLanguage();

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: t('language') === 'fr' ? 'Copié!' : 'Copied!',
      description: t('language') === 'fr' ? 'Adresse copiée dans le presse-papiers' : 'Address copied to clipboard',
    });
  };

  const selectedNetworkData = BLOCKCHAIN_NETWORKS.find(n => n.id === selectedNetwork);
  const depositAddress = walletAddresses[selectedNetwork] || 'Loading...';

  const simulateDeposit = () => {
    if (!amount || !txHash) {
      toast({
        title: t('language') === 'fr' ? 'Erreur' : 'Error',
        description: t('language') === 'fr' ? 'Veuillez remplir tous les champs' : 'Please fill all fields',
        variant: 'destructive'
      });
      return;
    }

    setIsProcessing(true);
    
    // Simulate processing time
    setTimeout(() => {
      setIsProcessing(false);
      toast({
        title: t('language') === 'fr' ? 'Dépôt en cours' : 'Deposit Processing',
        description: t('language') === 'fr' 
          ? 'Votre dépôt est en cours de traitement' 
          : 'Your deposit is being processed',
      });
      onClose();
    }, 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-bold">
            {t('language') === 'fr' ? 'Déposer XAFe' : 'Deposit XAFe'}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={selectedNetwork} onValueChange={setSelectedNetwork} className="w-full">
          <div className="mb-6">
            <Label className="text-base font-semibold mb-3 block">
              {t('language') === 'fr' ? 'Choisir un réseau blockchain' : 'Choose Blockchain Network'}
            </Label>
            <TabsList className="grid grid-cols-3 gap-1 h-auto p-1">
              {BLOCKCHAIN_NETWORKS.map((network) => (
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

          {BLOCKCHAIN_NETWORKS.map((network) => (
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
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">
                        {t('language') === 'fr' ? 'Frais' : 'Fees'}
                      </p>
                      <p className="font-semibold">{network.fees}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">
                        {t('language') === 'fr' ? 'Temps de confirmation' : 'Confirmation Time'}
                      </p>
                      <p className="font-semibold">{network.time}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t('language') === 'fr' ? 'Confirmations requises' : 'Required Confirmations'}
                      </p>
                      <p className="font-semibold">
                        {network.id === 'ethereum' ? '12' : network.id === 'tron' ? '3' : '6'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Deposit Address */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <Label className="font-semibold">
                      {t('language') === 'fr' ? 'Adresse de dépôt' : 'Deposit Address'}
                    </Label>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(depositAddress)}
                        className="h-8"
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        {t('language') === 'fr' ? 'Copier' : 'Copy'}
                      </Button>
                      <Button variant="outline" size="sm" className="h-8">
                        <QrCode className="h-3 w-3 mr-1" />
                        QR
                      </Button>
                    </div>
                  </div>
                  
                  <div className="bg-secondary/10 p-3 rounded-lg border-2 border-dashed border-secondary">
                    <p className="font-mono text-sm break-all">{depositAddress}</p>
                  </div>
                  
                  <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                      <div className="text-sm text-yellow-700">
                        <p className="font-semibold">
                          {t('language') === 'fr' ? 'Important:' : 'Important:'}
                        </p>
                        <p>
                          {t('language') === 'fr' 
                            ? 'Envoyez uniquement des tokens XAFe sur ce réseau. Tout autre actif sera perdu définitivement.'
                            : 'Only send XAFe tokens on this network. Any other assets will be permanently lost.'
                          }
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Manual Confirmation */}
              <Card>
                <CardContent className="p-4">
                  <h4 className="font-heading font-semibold mb-4">
                    {t('language') === 'fr' ? 'Confirmer la transaction' : 'Confirm Transaction'}
                  </h4>
                  
                  <div className="space-y-4">
                    <div>
                      <Label>
                        {t('language') === 'fr' ? 'Montant envoyé (XAFe)' : 'Amount Sent (XAFe)'}
                      </Label>
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    
                    <div>
                      <Label>
                        {t('language') === 'fr' ? 'Hash de transaction' : 'Transaction Hash'}
                      </Label>
                      <Input
                        placeholder={`${network.type} transaction hash`}
                        value={txHash}
                        onChange={(e) => setTxHash(e.target.value)}
                        className="mt-1 font-mono text-sm"
                      />
                    </div>
                    
                    <Button 
                      onClick={simulateDeposit}
                      disabled={isProcessing || !amount || !txHash}
                      className="w-full"
                    >
                      {isProcessing ? (
                        <>
                          <Clock className="h-4 w-4 mr-2 animate-spin" />
                          {t('language') === 'fr' ? 'Traitement...' : 'Processing...'}
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          {t('language') === 'fr' ? 'Confirmer le dépôt' : 'Confirm Deposit'}
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Explorer Links */}
              <Card>
                <CardContent className="p-4">
                  <h4 className="font-heading font-semibold mb-3">
                    {t('language') === 'fr' ? 'Liens utiles' : 'Useful Links'}
                  </h4>
                  
                  <div className="space-y-2">
                    <Button variant="outline" className="w-full justify-start" asChild>
                      <a 
                        href={getExplorerUrl(network.id)} 
                        target="_blank" 
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        {t('language') === 'fr' ? 'Explorer blockchain' : 'Blockchain Explorer'}
                      </a>
                    </Button>
                    
                    <Button variant="outline" className="w-full justify-start" asChild>
                      <a 
                        href={getContractUrl(network.id)} 
                        target="_blank" 
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        {t('language') === 'fr' ? 'Contrat XAFe' : 'XAFe Contract'}
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

// Helper functions for explorer URLs
const getExplorerUrl = (networkId: string): string => {
  const explorers: Record<string, string> = {
    ethereum: 'https://etherscan.io',
    tron: 'https://tronscan.org',
    bsc: 'https://bscscan.com',
    polygon: 'https://polygonscan.com',
    arbitrum: 'https://arbiscan.io',
    avalanche: 'https://snowtrace.io'
  };
  return explorers[networkId] || '#';
};

const getContractUrl = (networkId: string): string => {
  // Mock contract addresses - in production these would be real contract addresses
  const contracts: Record<string, string> = {
    ethereum: 'https://etherscan.io/token/0x...',
    tron: 'https://tronscan.org/#/token20/T...',
    bsc: 'https://bscscan.com/token/0x...',
    polygon: 'https://polygonscan.com/token/0x...',
    arbitrum: 'https://arbiscan.io/token/0x...',
    avalanche: 'https://snowtrace.io/token/0x...'
  };
  return contracts[networkId] || '#';
};