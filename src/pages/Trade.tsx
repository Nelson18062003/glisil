import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ArrowDownUp, BadgeDollarSign, ShoppingCart, SquareSlash, TrendingUpDown } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";

const FEE_RATE = 0.002; // 0.2%

type Side = "buy" | "sell";

type OrderType = "market" | "limit";

type Wallet = {
  id: string;
  user_id: string;
  usdt_balance: number;
  xafe_balance: number; // using XAF balance as XAFe
};

type Rate = { from_currency: string; to_currency: string; rate: number };

type TradeRow = {
  id: string;
  side: Side;
  price: number;
  amount: number;
  fee: number;
  created_at: string;
};

type OrderRow = {
  id: string;
  side: Side;
  type: OrderType;
  price: number | null;
  amount: number;
  filled_amount: number;
  status: "open" | "partial" | "filled" | "cancelled";
  created_at: string;
};

export default function Trade() {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [rates, setRates] = useState<Rate[]>([]);

  // UI state
  const [side, setSide] = useState<Side>("buy");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [amount, setAmount] = useState<string>(""); // amount of XAFE
  const [limitPrice, setLimitPrice] = useState<string>(""); // USDT per XAFE

  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [openOrders, setOpenOrders] = useState<OrderRow[]>([]);
  const [placing, setPlacing] = useState(false);

  // SEO basics
  useEffect(() => {
    document.title = "Trade XAFe | Buy/Sell XAFE with USDT";
    const desc = "Place market and limit orders to trade XAFE/USDT with low fees";
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", desc);

    // canonical
    let link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", window.location.href);
  }, []);

  useEffect(() => {
    // auth init
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id ?? null;
      setUserId(id);
      if (id) {
        fetchAll(id);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user?.id ?? null;
      setUserId(id);
      if (id) fetchAll(id);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const fetchAll = async (uid: string) => {
    const [{ data: w }, { data: r }, { data: t }, { data: o }] = await Promise.all([
      supabase.from("wallets").select("id,user_id,usdt_balance,xafe_balance").eq("user_id", uid).maybeSingle(),
      supabase.from("exchange_rates").select("from_currency,to_currency,rate"),
      supabase.from("trades").select("id,side,price,amount,fee,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
      supabase.from("orders").select("id,side,type,price,amount,filled_amount,status,created_at").eq("user_id", uid).in("status", ["open","partial"]).order("created_at", { ascending: false }),
    ]);

    if (w) setWallet(w as unknown as Wallet);
    if (r) setRates(r as Rate[]);
    if (t) setTrades(t as TradeRow[]);
    if (o) setOpenOrders(o as OrderRow[]);
  };

  const midPrice = useMemo(() => {
    const xafToUsdt = rates.find(r => r.from_currency === "XAF" && r.to_currency === "USDT");
    return xafToUsdt?.rate ?? 0.00168; // USDT per XAFE (assuming XAFe = 1 XAF)
  }, [rates]);

  const depthData = useMemo(() => {
    // Simulated depth around mid price
    const points = 20;
    const spread = midPrice * 0.01; // 1% band
    const arr = Array.from({ length: points }, (_, i) => {
      const x = i - points / 2;
      const price = +(midPrice + (x / points) * 2 * spread).toFixed(6);
      const bidSize = x <= 0 ? Math.round((Math.abs(x) + 1) * 50) : Math.round(Math.max(0, (points / 2 - x)) * 20);
      const askSize = x >= 0 ? Math.round((x + 1) * 50) : Math.round(Math.max(0, (points / 2 + x)) * 20);
      return { price, bids: bidSize, asks: askSize };
    });
    return arr;
  }, [midPrice]);

  const estCost = useMemo(() => {
    const amt = parseFloat(amount) || 0;
    const px = orderType === "limit" ? parseFloat(limitPrice) || 0 : midPrice;
    const gross = amt * px;
    const fee = gross * FEE_RATE;
    return { gross, fee, total: side === "buy" ? gross + fee : gross - fee };
  }, [amount, limitPrice, orderType, side, midPrice]);

  const placeOrder = async () => {
    if (!userId || !wallet) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Invalid amount", description: "Enter a positive amount", variant: "destructive" });
      return;
    }
    const limitPx = parseFloat(limitPrice);

    setPlacing(true);
    try {
      // Decide execution price
      const shouldFillNow = orderType === "market" || (orderType === "limit" && ((side === "buy" && limitPx >= midPrice) || (side === "sell" && limitPx <= midPrice)));
      const execPrice = orderType === "market" ? midPrice : (shouldFillNow ? midPrice : limitPx);

      if (shouldFillNow) {
        // Balance checks
        const gross = amt * execPrice;
        const fee = gross * FEE_RATE;
        if (side === "buy" && wallet.usdt_balance < gross + fee) {
          toast({ title: "Insufficient USDT", description: "Not enough USDT to buy", variant: "destructive" });
          return;
        }
        if (side === "sell" && wallet.xafe_balance < amt) {
          toast({ title: "Insufficient XAFe", description: "Not enough XAFe to sell", variant: "destructive" });
          return;
        }

        // 1) Insert filled order
        const { data: orderData, error: orderErr } = await supabase.from("orders").insert({
          user_id: userId,
          side,
          type: orderType,
          price: execPrice,
          amount: amt,
          filled_amount: amt,
          status: "filled",
        }).select("id").single();
        if (orderErr || !orderData) throw orderErr;

        // 2) Insert trade
        const { error: tradeErr } = await supabase.from("trades").insert({
          order_id: orderData.id,
          user_id: userId,
          side,
          price: execPrice,
          amount: amt,
          fee,
        });
        if (tradeErr) throw tradeErr;

        // 3) Update wallet
        if (side === "buy") {
          const newUsdt = +((wallet.usdt_balance - (gross + fee)).toFixed(6));
          const newXafe = +((wallet.xafe_balance + amt).toFixed(6));
          const { error: wErr } = await supabase.from("wallets").update({ usdt_balance: newUsdt, xafe_balance: newXafe }).eq("user_id", userId);
          if (wErr) throw wErr;
        } else {
          const newUsdt = +((wallet.usdt_balance + (gross - fee)).toFixed(6));
          const newXafe = +((wallet.xafe_balance - amt).toFixed(6));
          const { error: wErr } = await supabase.from("wallets").update({ usdt_balance: newUsdt, xafe_balance: newXafe }).eq("user_id", userId);
          if (wErr) throw wErr;
        }

        toast({ title: "Order filled", description: `${side.toUpperCase()} ${amt} XAFE @ ${execPrice.toFixed(6)} USDT` });
      } else {
        // Place open limit order
        if (!limitPx || limitPx <= 0) {
          toast({ title: "Invalid price", description: "Enter a positive limit price", variant: "destructive" });
          return;
        }
        const { error: orderErr } = await supabase.from("orders").insert({
          user_id: userId,
          side,
          type: "limit",
          price: limitPx,
          amount: amt,
          status: "open",
        });
        if (orderErr) throw orderErr;
        toast({ title: "Limit order placed", description: `${side.toUpperCase()} ${amt} XAFE @ ${limitPx} USDT` });
      }

      // Refresh
      await fetchAll(userId);
      setAmount("");
      setLimitPrice("");
    } catch (e) {
      console.error(e);
      toast({ title: "Order failed", description: "Could not place order", variant: "destructive" });
    } finally {
      setPlacing(false);
    }
  };

  const cancelOrder = async (orderId: string) => {
    if (!userId) return;
    const { error } = await supabase.from("orders").update({ status: "cancelled" }).eq("id", orderId).eq("user_id", userId);
    if (error) {
      toast({ title: "Cancel failed", description: "Could not cancel order", variant: "destructive" });
    } else {
      toast({ title: "Order cancelled" });
      fetchAll(userId);
    }
  };

  if (!userId) {
    return (
      <main className="container mx-auto max-w-5xl p-4">
        <h1 className="text-2xl font-bold">Trade XAFe — Buy/Sell with USDT</h1>
        <p className="text-muted-foreground mt-2">Please sign in to trade.</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-6xl p-4">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Trade XAFe — Buy/Sell with USDT</h1>
        <p className="text-sm text-muted-foreground">Fee 0.2% • Simulated matching @ mid price • Min order 1 XAFE</p>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trade panel */}
        <Card className="lg:col-span-1">
          <CardContent className="p-4">
            <div className="flex gap-2 mb-3">
              <Button variant={side === "buy" ? "xafe" : "outline"} onClick={() => setSide("buy")}>
                <ShoppingCart className="h-4 w-4 mr-2" /> Buy
              </Button>
              <Button variant={side === "sell" ? "destructive" : "outline"} onClick={() => setSide("sell")}>
                <BadgeDollarSign className="h-4 w-4 mr-2" /> Sell
              </Button>
            </div>

            <Tabs value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
              <TabsList className="mb-3">
                <TabsTrigger value="market">Market</TabsTrigger>
                <TabsTrigger value="limit">Limit</TabsTrigger>
              </TabsList>
              <TabsContent value="market">
                <div className="space-y-3">
                  <div>
                    <label className="text-sm">Amount (XAFE)</label>
                    <Input type="number" min="0" step="0.000001" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Price ≈ {midPrice.toFixed(6)} USDT • Fee {FEE_RATE * 100}%
                  </div>
                  <Button onClick={placeOrder} disabled={placing} className="w-full">
                    <ArrowDownUp className="h-4 w-4 mr-2" />
                    {placing ? "Placing..." : `${side === "buy" ? "Buy" : "Sell"} XAFE`}
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="limit">
                <div className="space-y-3">
                  <div>
                    <label className="text-sm">Amount (XAFE)</label>
                    <Input type="number" min="0" step="0.000001" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm">Limit Price (USDT)</label>
                    <Input type="number" min="0" step="0.000001" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Mid {midPrice.toFixed(6)} • Order executes instantly if price crosses
                  </div>
                  <Button onClick={placeOrder} disabled={placing} className="w-full" variant="outline">
                    <TrendingUpDown className="h-4 w-4 mr-2" />
                    {placing ? "Placing..." : `Place ${side} Limit`}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>

            <div className="mt-4 text-sm">
              <p className="font-medium">Balances</p>
              <p className="text-muted-foreground">USDT: {wallet?.usdt_balance.toFixed(2)} • XAFE: {wallet?.xafe_balance.toFixed(2)}</p>
            </div>

            <div className="mt-3 text-xs text-muted-foreground">
              Est. {side === "buy" ? "Cost" : "Proceeds"}: {estCost.total.toFixed(4)} USDT (fee {estCost.fee.toFixed(4)})
            </div>
          </CardContent>
        </Card>

        {/* Depth + History */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold">Market depth (simulated)</h2>
              </div>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={depthData}>
                    <defs>
                      <linearGradient id="bids" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--xafe-green))" stopOpacity={0.5}/>
                        <stop offset="95%" stopColor="hsl(var(--xafe-green))" stopOpacity={0.05}/>
                      </linearGradient>
                      <linearGradient id="asks" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.5}/>
                        <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0.05}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="price" tickFormatter={(v) => v.toFixed(4)} />
                    <YAxis />
                    <Tooltip formatter={(value: any, name: any) => [value, name]} />
                    <Area type="monotone" dataKey="bids" stroke="hsl(var(--xafe-green))" fill="url(#bids)" />
                    <Area type="monotone" dataKey="asks" stroke="hsl(var(--destructive))" fill="url(#asks)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold">Open orders</h2>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Side</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openOrders.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">No open orders</TableCell>
                      </TableRow>
                    )}
                    {openOrders.map(o => (
                      <TableRow key={o.id}>
                        <TableCell className={o.side === 'buy' ? 'text-xafe-green' : 'text-destructive'}>{o.side}</TableCell>
                        <TableCell>{o.type}</TableCell>
                        <TableCell>{o.price?.toFixed(6)}</TableCell>
                        <TableCell>{o.amount}</TableCell>
                        <TableCell>{o.status}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => cancelOrder(o.id)}>
                            <SquareSlash className="h-4 w-4 mr-1" /> Cancel
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold">Order history</h2>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Side</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Fee</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">No trades yet</TableCell>
                      </TableRow>
                    )}
                    {trades.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className={t.side === 'buy' ? 'text-xafe-green' : 'text-destructive'}>{t.side}</TableCell>
                        <TableCell>{t.price.toFixed(6)}</TableCell>
                        <TableCell>{t.amount}</TableCell>
                        <TableCell>{t.fee.toFixed(6)}</TableCell>
                        <TableCell>{new Date(t.created_at).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableCaption>Trades are executed at the simulated mid price.</TableCaption>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}
