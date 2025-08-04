import { useState, useEffect } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Wallet, 
  ArrowUpDown, 
  TrendingUp, 
  History, 
  Settings,
  Smartphone,
  Eye,
  EyeOff,
  Plus,
  Minus,
  CreditCard,
  Zap,
  ArrowRight,
  DollarSign,
  LogOut,
  Download,
  Upload
} from "lucide-react";
import xafeLogo from "@/assets/xafe-logo.png";
import { AuthComponent } from "./AuthWithSupabase";
import { XafeService, Wallet as WalletType, Transaction, ExchangeRate } from "@/services/xafeService";
import { useLanguage } from "@/contexts/LanguageContext";
import { LanguageSelector } from "@/components/LanguageSelector";
import { PriceChart } from "@/components/PriceChart";
import { DepositModal } from "@/components/DepositModal";
import { WithdrawModal } from "@/components/WithdrawModal";

export const XafeApp = () => {
  const { t } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [activeTab, setActiveTab] = useState("wallet");
  const [animateCards, setAnimateCards] = useState(false);
  const [wallet, setWallet] = useState<WalletType | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [walletAddresses, setWalletAddresses] = useState<Record<string, string>>({});
  const { toast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => setAnimateCards(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (user) {
      loadUserData();
    }
  }, [user]);

  const loadUserData = async () => {
    if (!user) return;
    
    try {
      const [walletData, transactionsData, ratesData] = await Promise.all([
        XafeService.getWallet(user.id),
        XafeService.getTransactions(user.id, 5),
        XafeService.getExchangeRates()
      ]);
      
      setWallet(walletData);
      setTransactions(transactionsData);
      setExchangeRates(ratesData);
      
      // Load wallet addresses if available
      await loadWalletAddresses();
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  const loadWalletAddresses = async () => {
    if (!user) return;
    
    try {
      const { data: walletData, error } = await supabase
        .from('wallets')
        .select('deposit_addresses')
        .eq('user_id', user.id)
        .single();
      
      if (error) throw error;
      
      if (walletData?.deposit_addresses && typeof walletData.deposit_addresses === 'object') {
        setWalletAddresses(walletData.deposit_addresses as Record<string, string>);
      }
    } catch (error) {
      console.error('Error loading wallet addresses:', error);
    }
  };

  const handleAuthSuccess = (user: User, session: Session) => {
    setUser(user);
    setSession(session);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setWallet(null);
    setTransactions([]);
    setExchangeRates([]);
  };

  // Get current exchange rate
  const getCurrentRate = () => {
    const xafToUsdt = exchangeRates.find(rate => rate.from_currency === 'XAF' && rate.to_currency === 'USDT');
    const usdtToXaf = exchangeRates.find(rate => rate.from_currency === 'USDT' && rate.to_currency === 'XAF');
    
    return {
      xafToUsdt: xafToUsdt?.rate || 0.00168,
      usdtToXaf: usdtToXaf?.rate || 595.24,
      priceChange: xafToUsdt?.change_24h || 2.4
    };
  };

  const rates = getCurrentRate();

  const handleDepositXafe = async () => {
    if (!user) return;
    
    const success = await XafeService.simulateDeposit(user.id, 10000, 'Dépôt direct XAFe');
    if (success) {
      toast({ title: "Dépôt réussi", description: "10,000 XAF ajoutés à votre wallet" });
      loadUserData();
    } else {
      toast({ title: "Erreur", description: "Échec du dépôt", variant: "destructive" });
    }
  };

  const handleMobileMoneyDeposit = async () => {
    if (!user) return;
    
    const success = await XafeService.simulateDeposit(user.id, 25000, 'MTN Mobile Money');
    if (success) {
      toast({ title: "Dépôt MoMo réussi", description: "25,000 XAF ajoutés via Mobile Money" });
      loadUserData();
    } else {
      toast({ title: "Erreur", description: "Échec du dépôt MoMo", variant: "destructive" });
    }
  };

  const handleConvertToUSDT = async () => {
    if (!user || !wallet) return;
    
    const exchangeRates = await XafeService.getExchangeRates();
    const usdtRate = exchangeRates.find(rate => rate.from_currency === 'USDT' && rate.to_currency === 'XAF');
    
    if (!usdtRate) {
      toast({ title: "Erreur", description: "Taux de change indisponible", variant: "destructive" });
      return;
    }

    const convertAmount = Math.min(50000, wallet.xafe_balance); // Convert up to 50k XAF
    if (convertAmount <= 0) {
      toast({ title: "Solde insuffisant", description: "Pas assez de XAF à convertir", variant: "destructive" });
      return;
    }

    // Converting XAF to USDT using the USDT/XAF rate (inverse)
    const success = await XafeService.simulateConversion(
      user.id, 
      'XAF', 
      'USDT', 
      convertAmount, 
      1 / usdtRate.rate // Use inverse rate since we have USDT/XAF but need XAF/USDT
    );
    
    if (success) {
      const usdtAmount = (convertAmount / usdtRate.rate).toFixed(2);
      toast({ 
        title: "Conversion réussie", 
        description: `${convertAmount.toLocaleString()} XAF → ${usdtAmount} USDT` 
      });
      loadUserData();
    } else {
      toast({ title: "Erreur", description: "Échec de la conversion", variant: "destructive" });
    }
  };

  const handleConvertToXAF = async () => {
    if (!user || !wallet) return;
    
    const exchangeRates = await XafeService.getExchangeRates();
    const xafRate = exchangeRates.find(rate => rate.from_currency === 'USDT' && rate.to_currency === 'XAF');
    
    if (!xafRate) {
      toast({ title: "Erreur", description: "Taux de change indisponible", variant: "destructive" });
      return;
    }

    const convertAmount = Math.min(50, wallet.usdt_balance); // Convert up to 50 USDT
    if (convertAmount <= 0) {
      toast({ title: "Solde insuffisant", description: "Pas assez d'USDT à convertir", variant: "destructive" });
      return;
    }

    const success = await XafeService.simulateConversion(
      user.id, 
      'USDT', 
      'XAF', 
      convertAmount, 
      xafRate.rate
    );
    
    if (success) {
      const xafAmount = (convertAmount * xafRate.rate).toLocaleString();
      toast({ 
        title: "Conversion réussie", 
        description: `${convertAmount} USDT → ${xafAmount} XAF` 
      });
      loadUserData();
    } else {
      toast({ title: "Erreur", description: "Échec de la conversion", variant: "destructive" });
    }
  };

  const WalletTab = () => {
    const { t } = useLanguage();
    
    return (
      <div className="space-y-6 animate-fade-in">
        {/* Price Ticker */}
        <div className="bg-gradient-card border border-xafe-green/20 rounded-xl p-4 animate-slide-up">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-primary rounded-full flex items-center justify-center animate-pulse-glow">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">USDT/XAF</p>
                <p className="font-heading font-bold text-lg text-xafe-green">
                  {rates.xafToUsdt}
                </p>
              </div>
            </div>
            <div className="text-right">
              <Badge 
                variant="secondary" 
                className={`bg-xafe-green/20 text-xafe-green animate-pulse ${
                  rates.priceChange > 0 ? 'animate-pulse-glow' : ''
                }`}
              >
                +{rates.priceChange}%
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">24h</p>
            </div>
          </div>
        </div>

        {/* Balance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className={`balance-card border-xafe-green/20 hover-lift ${animateCards ? 'animate-scale-in' : ''}`} 
                style={{ animationDelay: '0.1s' }}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-primary rounded-xl flex items-center justify-center shadow-glow-green animate-float">
                    <img src={xafeLogo} alt="XAFe" className="w-6 h-6 rounded" />
                  </div>
                  <div>
                    <h3 className="font-heading font-semibold text-foreground">XAFe</h3>
                    <p className="text-xs text-muted-foreground">Franc CFA numérique</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setBalanceVisible(!balanceVisible)}
                  className="h-8 w-8 action-button"
                >
                  {balanceVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
              </div>
              <div className="space-y-2">
                <p className="text-3xl font-heading font-bold text-xafe-green">
                  {balanceVisible ? `${wallet?.xafe_balance?.toLocaleString() || 0}` : "***"}
                  <span className="text-lg text-muted-foreground ml-2">XAF</span>
                </p>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-3 w-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    ≈ {balanceVisible ? `${((wallet?.xafe_balance || 0) * rates.xafToUsdt).toFixed(2)} USDT` : "***"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={`balance-card border-xafe-blue/20 hover-lift ${animateCards ? 'animate-scale-in' : ''}`}
                style={{ animationDelay: '0.2s' }}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-blue rounded-xl flex items-center justify-center shadow-glow-blue animate-float" 
                       style={{ animationDelay: '1s' }}>
                    <span className="text-white text-sm font-bold">₮</span>
                  </div>
                  <div>
                    <h3 className="font-heading font-semibold text-foreground">USDT</h3>
                    <p className="text-xs text-muted-foreground">Tether USD</p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs bg-xafe-blue/20 text-xafe-blue">BEP20</Badge>
              </div>
              <div className="space-y-2">
                <p className="text-3xl font-heading font-bold text-xafe-blue">
                  {balanceVisible ? `${wallet?.usdt_balance?.toFixed(2) || 0}` : "***"}
                  <span className="text-lg text-muted-foreground ml-2">USDT</span>
                </p>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-3 w-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    ≈ {balanceVisible ? `${((wallet?.usdt_balance || 0) * rates.usdtToXaf).toLocaleString()} XAF` : "***"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 animate-slide-up" style={{ animationDelay: '0.3s' }}>
          <Button 
            variant="xafe" 
            size="lg" 
            className="h-16 sm:h-20 flex-col action-button group p-3 sm:p-4"
            onClick={() => setIsDepositModalOpen(true)}
          >
            <div className="flex items-center justify-center w-8 h-8 sm:w-12 sm:h-12 bg-white/20 rounded-lg sm:rounded-xl mb-1 sm:mb-2 group-hover:scale-110 transition-transform">
              <Download className="h-4 w-4 sm:h-6 sm:w-6" />
            </div>
            <span className="font-heading font-semibold text-xs sm:text-sm text-center leading-tight">
              {t('language') === 'fr' ? 'Déposer XAFe' : 'Deposit XAFe'}
            </span>
          </Button>
          
          <Button 
            variant="destructive" 
            size="lg" 
            className="h-16 sm:h-20 flex-col action-button group p-3 sm:p-4"
            onClick={() => setIsWithdrawModalOpen(true)}
          >
            <div className="flex items-center justify-center w-8 h-8 sm:w-12 sm:h-12 bg-white/20 rounded-lg sm:rounded-xl mb-1 sm:mb-2 group-hover:scale-110 transition-transform">
              <Upload className="h-4 w-4 sm:h-6 sm:w-6" />
            </div>
            <span className="font-heading font-semibold text-xs sm:text-sm text-center leading-tight">
              {t('language') === 'fr' ? 'Retirer XAFe' : 'Withdraw XAFe'}
            </span>
          </Button>
          
          <Button 
            variant="momo" 
            size="lg" 
            className="h-16 sm:h-20 flex-col action-button group p-3 sm:p-4"
            onClick={() => handleMobileMoneyDeposit()}
          >
            <div className="flex items-center justify-center w-8 h-8 sm:w-12 sm:h-12 bg-white/20 rounded-lg sm:rounded-xl mb-1 sm:mb-2 group-hover:scale-110 transition-transform">
              <CreditCard className="h-4 w-4 sm:h-6 sm:w-6" />
            </div>
            <span className="font-heading font-semibold text-xs sm:text-sm text-center leading-tight">{t('createXafe')}</span>
          </Button>
          
          <Button 
            variant="orange" 
            size="lg" 
            className="h-16 sm:h-20 flex-col action-button group p-3 sm:p-4"
            onClick={() => handleConvertToXAF()}
          >
            <div className="flex items-center justify-center w-8 h-8 sm:w-12 sm:h-12 bg-white/20 rounded-lg sm:rounded-xl mb-1 sm:mb-2 group-hover:scale-110 transition-transform">
              <ArrowUpDown className="h-4 w-4 sm:h-6 sm:w-6" />
            </div>
            <span className="font-heading font-semibold text-xs sm:text-sm text-center leading-tight">{t('exchangeXafe')}</span>
          </Button>
        </div>

        {/* Recent Transactions */}
        <Card className="balance-card animate-slide-up" style={{ animationDelay: '0.4s' }}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-heading font-bold text-foreground">Transactions récentes</h3>
              <Button variant="ghost" size="sm" className="text-xafe-green hover:text-xafe-green">
                Voir tout
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
            <div className="space-y-4">
              {[
                { 
                  type: "Dépôt", 
                  amount: "+50,000 XAF", 
                  time: "Il y a 2h", 
                  method: "MTN MoMo",
                  icon: Plus,
                  color: "text-xafe-green",
                  bgColor: "bg-xafe-green/20"
                },
                { 
                  type: "Conversion", 
                  amount: "-10,000 XAF → +16.8 USDT", 
                  time: "Il y a 5h", 
                  method: "Spot",
                  icon: ArrowUpDown,
                  color: "text-xafe-blue",
                  bgColor: "bg-xafe-blue/20"
                },
                { 
                  type: "Dépôt", 
                  amount: "+25,000 XAF", 
                  time: "Hier", 
                  method: "Orange Money",
                  icon: Smartphone,
                  color: "text-xafe-orange",
                  bgColor: "bg-xafe-orange/20"
                }
              ].map((tx, index) => {
                const IconComponent = tx.icon;
                return (
                  <div key={index} className="flex items-center justify-between p-4 rounded-xl bg-secondary/10 hover:bg-secondary/20 transition-all duration-300 hover-lift group">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 ${tx.bgColor} rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform`}>
                        <IconComponent className={`h-6 w-6 ${tx.color}`} />
                      </div>
                      <div>
                        <p className="font-heading font-semibold text-foreground">{tx.type}</p>
                        <p className="text-sm text-muted-foreground">{tx.method}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-heading font-bold ${tx.color}`}>{tx.amount}</p>
                      <p className="text-xs text-muted-foreground">{tx.time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const ConvertTab = () => {
    const [fromAmount, setFromAmount] = useState("");
    const [toAmount, setToAmount] = useState("");
    const [swapDirection, setSwapDirection] = useState(true); // true: XAF->USDT, false: USDT->XAF

    const handleSwap = () => {
      setSwapDirection(!swapDirection);
      setFromAmount(toAmount);
      setToAmount(fromAmount);
    };

    const calculateConversion = (amount: string) => {
      const num = parseFloat(amount);
      if (isNaN(num)) return "";
      
      if (swapDirection) {
        return (num * rates.xafToUsdt).toFixed(6);
      } else {
        return (num * rates.usdtToXaf).toFixed(2);
      }
    };

    const handleFromAmountChange = (value: string) => {
      setFromAmount(value);
      setToAmount(calculateConversion(value));
    };

    return (
      <div className="space-y-6 animate-fade-in">
        <Card className="balance-card animate-scale-in">
          <CardContent className="p-8">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-heading font-bold mb-2">Conversion rapide</h3>
              <p className="text-muted-foreground">Échangez instantanément vos cryptomonnaies</p>
            </div>
            
            <div className="space-y-6">
              <div className="text-center p-4 bg-gradient-primary/10 rounded-xl border border-xafe-green/20">
                <p className="text-sm text-muted-foreground mb-2">Taux de change actuel</p>
                <p className="text-3xl font-heading font-bold text-xafe-green">
                  1 USDT = {rates.usdtToXaf.toLocaleString()} XAF
                </p>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <Badge variant="secondary" className="bg-xafe-green/20 text-xafe-green animate-pulse-glow">
                    +{rates.priceChange}% 24h
                  </Badge>
                </div>
              </div>
              
              {/* From Currency */}
              <div className="bg-secondary/10 p-6 rounded-xl border border-white/10 hover-lift">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-heading font-semibold">
                    De: {swapDirection ? 'XAFe' : 'USDT'}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Solde: {swapDirection 
                      ? `${wallet?.xafe_balance?.toLocaleString() || 0} XAF` 
                      : `${wallet?.usdt_balance?.toFixed(2) || 0} USDT`
                    }
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 ${swapDirection ? 'bg-gradient-primary' : 'bg-gradient-blue'} rounded-xl flex items-center justify-center`}>
                    {swapDirection ? (
                      <img src={xafeLogo} alt="XAFe" className="w-6 h-6 rounded" />
                    ) : (
                      <span className="text-white font-bold">₮</span>
                    )}
                  </div>
                  <input 
                    type="number" 
                    placeholder="0"
                    value={fromAmount}
                    onChange={(e) => handleFromAmountChange(e.target.value)}
                    className="flex-1 bg-transparent text-3xl font-heading font-bold outline-none text-foreground placeholder-muted-foreground"
                  />
                  <span className="text-muted-foreground font-semibold">
                    {swapDirection ? 'XAF' : 'USDT'}
                  </span>
                </div>
              </div>

              {/* Swap Button */}
              <div className="flex justify-center">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={handleSwap}
                  className="rounded-full w-12 h-12 bg-gradient-primary hover:scale-110 transition-all duration-300 shadow-glow-green"
                >
                  <ArrowUpDown className="h-6 w-6 text-white" />
                </Button>
              </div>

              {/* To Currency */}
              <div className="bg-secondary/10 p-6 rounded-xl border border-white/10 hover-lift">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-heading font-semibold">
                    Vers: {swapDirection ? 'USDT' : 'XAFe'}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Solde: {swapDirection 
                      ? `${wallet?.usdt_balance?.toFixed(2) || 0} USDT`
                      : `${wallet?.xafe_balance?.toLocaleString() || 0} XAF`
                    }
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 ${swapDirection ? 'bg-gradient-blue' : 'bg-gradient-primary'} rounded-xl flex items-center justify-center`}>
                    {swapDirection ? (
                      <span className="text-white font-bold">₮</span>
                    ) : (
                      <img src={xafeLogo} alt="XAFe" className="w-6 h-6 rounded" />
                    )}
                  </div>
                  <input 
                    type="number" 
                    placeholder="0"
                    value={toAmount}
                    readOnly
                    className="flex-1 bg-transparent text-3xl font-heading font-bold outline-none text-foreground placeholder-muted-foreground"
                  />
                  <span className="text-muted-foreground font-semibold">
                    {swapDirection ? 'USDT' : 'XAF'}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <Button 
                  variant="xafe" 
                  size="xl" 
                  className="w-full action-button font-heading font-bold text-lg"
                  disabled={!fromAmount || parseFloat(fromAmount) <= 0}
                >
                  <Zap className="h-5 w-5 mr-2" />
                  Convertir maintenant
                </Button>
                
                <div className="text-center text-sm text-muted-foreground">
                  <p>Frais de conversion: 0.1% • Traitement instantané</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const MarketTab = () => (
    <div className="space-y-6 animate-fade-in">
      {/* Market Overview */}
      <PriceChart />
      
      <Card className="balance-card animate-scale-in" style={{ animationDelay: '0.4s' }}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-primary rounded-xl flex items-center justify-center animate-float">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="text-2xl font-heading font-bold">XAFe/USDT</h3>
                <p className="text-sm text-muted-foreground">{t('language') === 'fr' ? 'Marché Spot' : 'Spot Market'}</p>
              </div>
            </div>
            <Badge variant="secondary" className="bg-xafe-green/20 text-xafe-green animate-pulse-glow text-lg px-3 py-1">
              +{rates.priceChange}%
            </Badge>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-4 bg-secondary/10 rounded-xl hover-lift">
              <p className="text-sm text-muted-foreground mb-1">Prix actuel</p>
              <p className="text-xl font-heading font-bold text-xafe-green">{rates.xafToUsdt}</p>
            </div>
            <div className="text-center p-4 bg-secondary/10 rounded-xl hover-lift">
              <p className="text-sm text-muted-foreground mb-1">24h High</p>
              <p className="text-xl font-heading font-bold">0.00172</p>
            </div>
            <div className="text-center p-4 bg-secondary/10 rounded-xl hover-lift">
              <p className="text-sm text-muted-foreground mb-1">24h Low</p>
              <p className="text-xl font-heading font-bold">0.00164</p>
            </div>
            <div className="text-center p-4 bg-secondary/10 rounded-xl hover-lift">
              <p className="text-sm text-muted-foreground mb-1">Volume 24h</p>
              <p className="text-xl font-heading font-bold">2.4M XAF</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Button variant="xafe" size="lg" className="action-button font-heading font-bold">
              <Plus className="h-5 w-5 mr-2" />
              Acheter XAFe
            </Button>
            <Button variant="outline" size="lg" className="action-button font-heading font-bold border-destructive text-destructive hover:bg-destructive hover:text-white">
              <Minus className="h-5 w-5 mr-2" />
              Vendre XAFe
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Order Book */}
      <Card className="balance-card animate-slide-up" style={{ animationDelay: '0.2s' }}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-xl font-heading font-bold">Carnet d'ordres</h4>
            <Badge variant="secondary" className="text-xs">DEMO</Badge>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Sell Orders */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-3 h-3 bg-destructive rounded-full"></div>
                <h5 className="font-heading font-semibold text-destructive">Ordres de vente</h5>
              </div>
              <div className="space-y-2">
                {[
                  { price: "0.00170", amount: "5,000", total: "8.50" },
                  { price: "0.00169", amount: "12,000", total: "20.28" },
                  { price: "0.00168", amount: "8,500", total: "14.28" }
                ].map((order, index) => (
                  <div key={index} className="flex justify-between items-center p-3 rounded-lg bg-destructive/5 hover:bg-destructive/10 transition-colors cursor-pointer">
                    <span className="text-destructive font-semibold">{order.price}</span>
                    <span className="text-sm">{order.amount}</span>
                    <span className="text-xs text-muted-foreground">{order.total}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Buy Orders */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-3 h-3 bg-xafe-green rounded-full"></div>
                <h5 className="font-heading font-semibold text-xafe-green">Ordres d'achat</h5>
              </div>
              <div className="space-y-2">
                {[
                  { price: "0.00167", amount: "3,200", total: "5.34" },
                  { price: "0.00166", amount: "15,000", total: "24.90" },
                  { price: "0.00165", amount: "7,800", total: "12.87" }
                ].map((order, index) => (
                  <div key={index} className="flex justify-between items-center p-3 rounded-lg bg-xafe-green/5 hover:bg-xafe-green/10 transition-colors cursor-pointer">
                    <span className="text-xafe-green font-semibold">{order.price}</span>
                    <span className="text-sm">{order.amount}</span>
                    <span className="text-xs text-muted-foreground">{order.total}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="mt-6 p-4 bg-gradient-primary/10 rounded-xl border border-xafe-green/20">
            <p className="text-center text-sm text-muted-foreground">
              💡 Le carnet d'ordres sera connecté à l'infrastructure Hyperliquid dans la version finale
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const HistoryTab = () => (
    <div className="space-y-6 animate-fade-in">
      {/* Filter Options */}
      <Card className="balance-card animate-scale-in">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <h3 className="text-xl font-heading font-bold">Historique des transactions</h3>
            <div className="flex gap-2">
              <Badge variant="secondary" className="cursor-pointer hover:bg-xafe-green/20 hover:text-xafe-green">
                Tout
              </Badge>
              <Badge variant="outline" className="cursor-pointer hover:bg-xafe-green/20 hover:text-xafe-green">
                Dépôts
              </Badge>
              <Badge variant="outline" className="cursor-pointer hover:bg-xafe-blue/20 hover:text-xafe-blue">
                Conversions
              </Badge>
              <Badge variant="outline" className="cursor-pointer hover:bg-xafe-orange/20 hover:text-xafe-orange">
                Mobile Money
              </Badge>
            </div>
          </div>
          
          <div className="space-y-3">
            {[
              {
                id: "TXN001",
                type: "Dépôt",
                amount: "+50,000 XAF",
                time: "2024-01-15 14:30",
                method: "MTN MoMo",
                status: "Confirmé",
                icon: Plus,
                color: "text-xafe-green",
                bgColor: "bg-xafe-green/20",
                statusColor: "bg-xafe-green/20 text-xafe-green"
              },
              {
                id: "TXN002",
                type: "Conversion",
                amount: "-10,000 XAF → +16.8 USDT",
                time: "2024-01-15 09:15",
                method: "Marché Spot",
                status: "Terminé",
                icon: ArrowUpDown,
                color: "text-xafe-blue",
                bgColor: "bg-xafe-blue/20",
                statusColor: "bg-xafe-blue/20 text-xafe-blue"
              },
              {
                id: "TXN003",
                type: "Dépôt",
                amount: "+25,000 XAF",
                time: "2024-01-14 16:45",
                method: "Orange Money",
                status: "Confirmé",
                icon: Smartphone,
                color: "text-xafe-orange",
                bgColor: "bg-xafe-orange/20",
                statusColor: "bg-xafe-orange/20 text-xafe-orange"
              },
              {
                id: "TXN004",
                type: "Conversion",
                amount: "+5,000 XAF ← -8.4 USDT",
                time: "2024-01-14 11:20",
                method: "Conversion rapide",
                status: "Terminé",
                icon: ArrowUpDown,
                color: "text-xafe-blue",
                bgColor: "bg-xafe-blue/20",
                statusColor: "bg-xafe-blue/20 text-xafe-blue"
              },
              {
                id: "TXN005",
                type: "Dépôt",
                amount: "+75,000 XAF",
                time: "2024-01-13 08:30",
                method: "MTN MoMo",
                status: "En attente",
                icon: Plus,
                color: "text-muted-foreground",
                bgColor: "bg-secondary/20",
                statusColor: "bg-yellow-500/20 text-yellow-600"
              }
            ].map((tx, index) => {
              const IconComponent = tx.icon;
              return (
                <div 
                  key={index} 
                  className="flex items-center justify-between p-4 rounded-xl bg-secondary/5 hover:bg-secondary/10 transition-all duration-300 hover-lift border border-white/5"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 ${tx.bgColor} rounded-xl flex items-center justify-center`}>
                      <IconComponent className={`h-6 w-6 ${tx.color}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <p className="font-heading font-semibold text-foreground">{tx.type}</p>
                        <Badge variant="secondary" className={`text-xs ${tx.statusColor}`}>
                          {tx.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{tx.method}</p>
                      <p className="text-xs text-muted-foreground">ID: {tx.id}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-heading font-bold text-lg ${tx.color}`}>{tx.amount}</p>
                    <p className="text-xs text-muted-foreground">{tx.time}</p>
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="text-center mt-6">
            <Button variant="outline" className="action-button">
              Charger plus de transactions
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: '0.2s' }}>
        <Card className="balance-card hover-lift">
          <CardContent className="p-6 text-center">
            <div className="w-12 h-12 bg-gradient-primary rounded-xl flex items-center justify-center mx-auto mb-3">
              <Plus className="h-6 w-6 text-white" />
            </div>
            <p className="text-2xl font-heading font-bold text-xafe-green">150,000 XAF</p>
            <p className="text-sm text-muted-foreground">Total déposé ce mois</p>
          </CardContent>
        </Card>
        
        <Card className="balance-card hover-lift">
          <CardContent className="p-6 text-center">
            <div className="w-12 h-12 bg-gradient-blue rounded-xl flex items-center justify-center mx-auto mb-3">
              <ArrowUpDown className="h-6 w-6 text-white" />
            </div>
            <p className="text-2xl font-heading font-bold text-xafe-blue">25.2 USDT</p>
            <p className="text-sm text-muted-foreground">Total converti</p>
          </CardContent>
        </Card>
        
        <Card className="balance-card hover-lift">
          <CardContent className="p-6 text-center">
            <div className="w-12 h-12 bg-gradient-orange rounded-xl flex items-center justify-center mx-auto mb-3">
              <Smartphone className="h-6 w-6 text-white" />
            </div>
            <p className="text-2xl font-heading font-bold text-xafe-orange">12</p>
            <p className="text-sm text-muted-foreground">Transactions MoMo</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  // Show authentication screen if not authenticated
  if (!user) {
    return <AuthComponent onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-card border-b border-border/40 px-4 py-6 animate-slide-up">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={xafeLogo} alt="XAFe" className="w-10 h-10 rounded-lg animate-float" />
              <div>
                <h1 className="text-xl font-heading font-bold text-foreground">XAFe App</h1>
                <p className="text-sm text-muted-foreground">
                  {t('language') === 'fr' ? 'Votre stablecoin XAF' : 'Your XAF stablecoin'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <LanguageSelector />
              <Badge variant="secondary" className="bg-xafe-green/20 text-xafe-green animate-pulse-glow">
                {t('language') === 'fr' ? 'En ligne' : 'Online'}
              </Badge>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={handleLogout}
                className="action-button"
              >
                <Settings className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6 animate-fade-in">
            <TabsTrigger value="wallet" className="flex items-center gap-2 font-heading">
              <Wallet className="h-4 w-4" />
              <span className="hidden sm:inline">Portefeuille</span>
            </TabsTrigger>
            <TabsTrigger value="convert" className="flex items-center gap-2 font-heading">
              <ArrowUpDown className="h-4 w-4" />
              <span className="hidden sm:inline">Convertir</span>
            </TabsTrigger>
            <TabsTrigger value="market" className="flex items-center gap-2 font-heading">
              <TrendingUp className="h-4 w-4" />
              <span className="hidden sm:inline">Marché</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2 font-heading">
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">Historique</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="wallet">
            <WalletTab />
          </TabsContent>

          <TabsContent value="convert">
            <ConvertTab />
          </TabsContent>

          <TabsContent value="market">
            <MarketTab />
          </TabsContent>

          <TabsContent value="history">
            <HistoryTab />
          </TabsContent>
        </Tabs>
      </div>
      
      {/* Deposit Modal */}
      <DepositModal 
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
        walletAddresses={walletAddresses}
      />
      
      {/* Withdraw Modal */}
      <WithdrawModal 
        isOpen={isWithdrawModalOpen}
        onClose={() => setIsWithdrawModalOpen(false)}
        balance={wallet?.xafe_balance || 0}
      />
    </div>
  );
};