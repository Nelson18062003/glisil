import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DollarSign
} from "lucide-react";
import xafeLogo from "@/assets/xafe-logo.png";

export const XafeApp = () => {
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [activeTab, setActiveTab] = useState("wallet");
  const [animateCards, setAnimateCards] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setAnimateCards(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const mockData = {
    xafeBalance: 125000,
    usdtBalance: 85.50,
    xafToUsdt: 0.00168,
    usdtToXaf: 595.24,
    priceChange: +2.4
  };

  const WalletTab = () => (
    <div className="space-y-6 animate-fade-in">
      {/* Price Ticker */}
      <div className="bg-gradient-card border border-xafe-green/20 rounded-xl p-4 animate-slide-up">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-primary rounded-full flex items-center justify-center animate-pulse-glow">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">XAFé/USDT</p>
              <p className="font-heading font-bold text-lg text-xafe-green">
                {mockData.xafToUsdt}
              </p>
            </div>
          </div>
          <div className="text-right">
            <Badge 
              variant="secondary" 
              className={`bg-xafe-green/20 text-xafe-green animate-pulse ${
                mockData.priceChange > 0 ? 'animate-pulse-glow' : ''
              }`}
            >
              +{mockData.priceChange}%
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
                  <img src={xafeLogo} alt="XAFé" className="w-6 h-6 rounded" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-foreground">XAFé</h3>
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
                {balanceVisible ? `${mockData.xafeBalance.toLocaleString()}` : "***"}
                <span className="text-lg text-muted-foreground ml-2">XAF</span>
              </p>
              <div className="flex items-center gap-2">
                <DollarSign className="h-3 w-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  ≈ {balanceVisible ? `${(mockData.xafeBalance * mockData.xafToUsdt).toFixed(2)} USDT` : "***"}
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
                {balanceVisible ? `${mockData.usdtBalance.toFixed(2)}` : "***"}
                <span className="text-lg text-muted-foreground ml-2">USDT</span>
              </p>
              <div className="flex items-center gap-2">
                <DollarSign className="h-3 w-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  ≈ {balanceVisible ? `${(mockData.usdtBalance * mockData.usdtToXaf).toLocaleString()} XAF` : "***"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: '0.3s' }}>
        <Button variant="xafe" size="lg" className="h-20 flex-col action-button group">
          <div className="flex items-center justify-center w-12 h-12 bg-white/20 rounded-xl mb-2 group-hover:scale-110 transition-transform">
            <Plus className="h-6 w-6" />
          </div>
          <span className="font-heading font-semibold">Déposer XAF</span>
        </Button>
        <Button variant="momo" size="lg" className="h-20 flex-col action-button group">
          <div className="flex items-center justify-center w-12 h-12 bg-white/20 rounded-xl mb-2 group-hover:scale-110 transition-transform">
            <Smartphone className="h-6 w-6" />
          </div>
          <span className="font-heading font-semibold">Mobile Money</span>
        </Button>
        <Button variant="orange" size="lg" className="h-20 flex-col action-button group">
          <div className="flex items-center justify-center w-12 h-12 bg-white/20 rounded-xl mb-2 group-hover:scale-110 transition-transform">
            <ArrowUpDown className="h-6 w-6" />
          </div>
          <span className="font-heading font-semibold">Convertir</span>
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

  const ConvertTab = () => (
    <div className="space-y-6">
      <Card className="bg-gradient-card">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold mb-4">Conversion rapide</h3>
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2">Taux actuel</p>
              <p className="text-2xl font-bold text-xafe-green">1 USDT = {mockData.usdtToXaf} XAF</p>
            </div>
            
            <div className="bg-secondary/20 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <span>De: XAFé</span>
                <span>Solde: {mockData.xafeBalance.toLocaleString()} XAF</span>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="number" 
                  placeholder="0"
                  className="flex-1 bg-transparent text-2xl font-semibold outline-none"
                />
                <span className="text-muted-foreground">XAF</span>
              </div>
            </div>

            <div className="flex justify-center">
              <Button variant="ghost" size="icon" className="rounded-full">
                <ArrowUpDown className="h-5 w-5" />
              </Button>
            </div>

            <div className="bg-secondary/20 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <span>Vers: USDT</span>
                <span>Solde: {mockData.usdtBalance} USDT</span>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="number" 
                  placeholder="0"
                  className="flex-1 bg-transparent text-2xl font-semibold outline-none"
                />
                <span className="text-muted-foreground">USDT</span>
              </div>
            </div>

            <Button variant="xafe" size="xl" className="w-full">
              Convertir maintenant
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const MarketTab = () => (
    <div className="space-y-6">
      <Card className="bg-gradient-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">XAFé/USDT</h3>
            <Badge variant="secondary" className="bg-xafe-green/20 text-xafe-green">
              +2.4%
            </Badge>
          </div>
          
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Prix</p>
              <p className="text-lg font-bold text-xafe-green">{mockData.xafToUsdt}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">24h High</p>
              <p className="text-lg font-bold">0.00172</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">24h Low</p>
              <p className="text-lg font-bold">0.00164</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Button variant="xafe" className="w-full">
                Acheter XAFé
              </Button>
              <Button variant="outline" className="w-full">
                Vendre XAFé
              </Button>
            </div>
            
            <div className="bg-secondary/20 p-4 rounded-lg">
              <h4 className="font-semibold mb-3">Carnet d'ordres (Demo)</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-destructive font-medium mb-2">Ventes</p>
                  {[
                    { price: "0.00170", amount: "5,000" },
                    { price: "0.00169", amount: "12,000" },
                    { price: "0.00168", amount: "8,500" }
                  ].map((order, index) => (
                    <div key={index} className="flex justify-between py-1">
                      <span className="text-destructive">{order.price}</span>
                      <span>{order.amount}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xafe-green font-medium mb-2">Achats</p>
                  {[
                    { price: "0.00167", amount: "3,200" },
                    { price: "0.00166", amount: "15,000" },
                    { price: "0.00165", amount: "7,800" }
                  ].map((order, index) => (
                    <div key={index} className="flex justify-between py-1">
                      <span className="text-xafe-green">{order.price}</span>
                      <span>{order.amount}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-card border-b border-border/40 px-4 py-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={xafeLogo} alt="XAFé" className="w-10 h-10 rounded-lg" />
              <div>
                <h1 className="text-xl font-bold text-foreground">XAFé App</h1>
                <p className="text-sm text-muted-foreground">Votre crypto-monnaie XAF</p>
              </div>
            </div>
            <Button variant="ghost" size="icon">
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="wallet" className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              <span className="hidden sm:inline">Portefeuille</span>
            </TabsTrigger>
            <TabsTrigger value="convert" className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4" />
              <span className="hidden sm:inline">Convertir</span>
            </TabsTrigger>
            <TabsTrigger value="market" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <span className="hidden sm:inline">Marché</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
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
            <Card className="bg-gradient-card">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-4">Historique complet</h3>
                <p className="text-muted-foreground text-center py-8">
                  Fonctionnalité en développement...
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};