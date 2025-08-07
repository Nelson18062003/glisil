import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { CryptoService } from '@/services/cryptoService';

interface WithdrawalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onWithdraw: (network: string, address: string, amount: number) => Promise<void>;
  currentBalance: number;
}

const SUPPORTED_NETWORKS = [
  { id: 'TRC20', name: 'Tron (TRC20)', minWithdraw: 10, fees: 1 },
  { id: 'ERC20', name: 'Ethereum (ERC20)', minWithdraw: 50, fees: 15 },
  { id: 'BEP20', name: 'BNB Smart Chain (BEP20)', minWithdraw: 20, fees: 2 },
  { id: 'POLYGON', name: 'Polygon', minWithdraw: 15, fees: 1 },
  { id: 'ARBITRUM', name: 'Arbitrum', minWithdraw: 30, fees: 5 },
  { id: 'AVALANCHE', name: 'Avalanche C-Chain', minWithdraw: 25, fees: 3 },
];

export function WithdrawalModal({ isOpen, onClose, onWithdraw, currentBalance }: WithdrawalModalProps) {
  const [selectedNetwork, setSelectedNetwork] = useState('TRC20');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [recentWithdrawals, setRecentWithdrawals] = useState<any[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<any[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      loadRecentWithdrawals();
      loadSavedAddresses();
    }
  }, [isOpen]);

  const loadRecentWithdrawals = async () => {
    try {
      const withdrawals = await CryptoService.getRecentWithdrawals();
      setRecentWithdrawals(withdrawals);
    } catch (error) {
      console.error('Error loading withdrawals:', error);
    }
  };

  const loadSavedAddresses = async () => {
    try {
      const addresses = await CryptoService.getUserWalletAddresses();
      setSavedAddresses(addresses);
    } catch (error) {
      console.error('Error loading saved addresses:', error);
    }
  };

  const selectedNetworkInfo = SUPPORTED_NETWORKS.find(n => n.id === selectedNetwork);
  const netAmount = amount ? parseFloat(amount) - (selectedNetworkInfo?.fees || 0) : 0;
  const isValidAmount = amount && parseFloat(amount) >= (selectedNetworkInfo?.minWithdraw || 0);
  const hasSufficientBalance = amount && parseFloat(amount) <= currentBalance;

  const validateAddress = (addr: string, network: string): boolean => {
    if (!addr) return false;
    
    switch (network) {
      case 'TRC20':
        return addr.startsWith('T') && addr.length === 34;
      case 'ERC20':
      case 'BEP20':
      case 'POLYGON':
      case 'ARBITRUM':
        return addr.startsWith('0x') && addr.length === 42;
      case 'AVALANCHE':
        return (addr.startsWith('0x') && addr.length === 42) || addr.startsWith('X-avax');
      default:
        return false;
    }
  };

  const handleWithdraw = async () => {
    if (!isValidAmount) {
      toast({
        title: "Error",
        description: `Minimum amount: ${selectedNetworkInfo?.minWithdraw} XAFe`,
        variant: "destructive"
      });
      return;
    }

    if (!hasSufficientBalance) {
      toast({
        title: "Error",
        description: "Insufficient balance",
        variant: "destructive"
      });
      return;
    }

    if (!validateAddress(address, selectedNetwork)) {
      toast({
        title: "Error",
        description: "Invalid withdrawal address for this network",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    try {
      await onWithdraw(selectedNetwork, address, parseFloat(amount));
      toast({
        title: "Withdrawal initiated",
        description: "Your withdrawal request has been submitted for processing",
      });
      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description: "Error initiating withdrawal",
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Withdraw XAFe</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Balance Info */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
            <div className="text-sm font-medium text-blue-800 dark:text-blue-300">
              Available balance: {currentBalance.toLocaleString()} XAFe
            </div>
          </div>

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
                        Min: {network.minWithdraw} | Fee: {network.fees} XAFe
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Withdrawal Address */}
          <div className="space-y-2">
            <Label>Destination address</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value.trim())}
              placeholder={`Enter a valid ${selectedNetwork} address`}
              className={`font-mono text-sm ${
                address && !validateAddress(address, selectedNetwork) 
                  ? 'border-red-500' 
                  : ''
              }`}
            />
            {address && !validateAddress(address, selectedNetwork) && (
              <div className="text-sm text-red-500">
                Invalid address for {selectedNetwork}
              </div>
            )}
            
            {/* Saved Addresses */}
            {savedAddresses.filter(addr => addr.network === selectedNetwork).length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Saved addresses:</div>
                <div className="flex flex-wrap gap-1">
                  {savedAddresses
                    .filter(addr => addr.network === selectedNetwork)
                    .map((addr) => (
                      <Button
                        key={addr.id}
                        variant="outline"
                        size="sm"
                        className="text-xs h-8"
                        onClick={() => setAddress(addr.address)}
                      >
                        {addr.address.slice(0, 8)}...{addr.address.slice(-6)}
                      </Button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <Label>Montant à retirer (XAFe)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Min: ${selectedNetworkInfo?.minWithdraw} XAFe`}
              min={selectedNetworkInfo?.minWithdraw}
              max={currentBalance}
              step="0.01"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Minimum: {selectedNetworkInfo?.minWithdraw} XAFe</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => setAmount(currentBalance.toString())}
              >
                Use max
              </Button>
            </div>
          </div>

          {/* Fee Calculation */}
          {amount && selectedNetworkInfo && (
            <div className="bg-gray-50 dark:bg-gray-900/50 border rounded-lg p-3">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Requested amount:</span>
                  <span>{parseFloat(amount).toLocaleString()} XAFe</span>
                </div>
                <div className="flex justify-between">
                  <span>Network fee:</span>
                  <span>-{selectedNetworkInfo.fees} XAFe</span>
                </div>
                <div className="flex justify-between font-medium border-t pt-1">
                  <span>Net amount received:</span>
                  <span>{Math.max(0, netAmount).toLocaleString()} XAFe</span>
                </div>
              </div>
            </div>
          )}

          {/* Security Notice */}
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-4">
            <div className="flex items-start space-x-2">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-red-800 dark:text-red-300 mb-1">
                  Attention - Important checks:
                </div>
                <ul className="text-red-700 dark:text-red-400 space-y-1">
                  <li>• Verify the address matches the correct network</li>
                  <li>• Withdrawals are irreversible</li>
                  <li>• Double-check the destination address</li>
                  <li>• Address errors lead to permanent loss</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Recent Withdrawals */}
          {recentWithdrawals.length > 0 && (
            <div className="space-y-2">
              <Label>Recent withdrawals</Label>
              <div className="border rounded-lg p-3 max-h-32 overflow-y-auto">
                {recentWithdrawals.slice(0, 3).map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b last:border-b-0">
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(tx.status)}
                      <div>
                        <div className="text-sm font-medium">{tx.amount} XAFe</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {tx.wallet_address.slice(0, 10)}...{tx.wallet_address.slice(-8)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={tx.status === 'confirmed' ? 'default' : 'secondary'}>
                        {getStatusText(tx.status)}
                      </Badge>
                      <div className="text-xs text-muted-foreground">{tx.network}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex space-x-2">
            <Button
              onClick={handleWithdraw}
              disabled={
                isLoading || 
                !isValidAmount || 
                !hasSufficientBalance || 
                !validateAddress(address, selectedNetwork)
              }
              className="flex-1"
            >
              {isLoading ? "Processing..." : `Withdraw ${netAmount > 0 ? netAmount.toLocaleString() : 0} XAFe`}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}