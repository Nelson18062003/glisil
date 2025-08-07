import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, RefreshCw, CheckCircle2, XCircle } from "lucide-react";

export default function Admin() {
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  // data
  const [profiles, setProfiles] = useState<any[]>([]);
  const [wallets, setWallets] = useState<any[]>([]);
  const [mintOps, setMintOps] = useState<any[]>([]);
  const [cryptoTx, setCryptoTx] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);

  useEffect(() => {
    document.title = "Admin | XAFe Backoffice";
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name','description'); document.head.appendChild(meta); }
    meta!.setAttribute('content','XAFe admin: manage users, wallets, minting, crypto transactions, orders, and rates.');
    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
    link!.href = window.location.href;
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const id = session?.user?.id ?? null;
      setUserId(id);
      if (id) checkAdmin(id);
    });
    supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user?.id ?? null;
      setUserId(id);
      if (id) checkAdmin(id);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const checkAdmin = async (uid: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('has_role', { _user_id: uid, _role: 'admin' });
      if (error) throw error;
      setIsAdmin(!!data);
      if (data) await fetchAll();
    } catch (e) {
      console.error(e);
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  };

  const bootstrapAdmin = async () => {
    try {
      const { data, error } = await supabase.rpc('bootstrap_admin');
      if (error) throw error;
      if (data) {
        toast({ title: 'You are now admin' });
        // re-check
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData.session?.user?.id;
        if (uid) await checkAdmin(uid);
      } else {
        toast({ title: 'Admin already initialized', description: 'Contact an admin to grant access.' });
      }
    } catch (e) {
      console.error(e);
      toast({ title: 'Bootstrap failed', variant: 'destructive' });
    }
  };

  const fetchAll = async () => {
    const [p, w, m, c, o, t, r] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('wallets').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('mint_operations').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('crypto_transactions').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('trades').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('exchange_rates').select('*').order('created_at', { ascending: false }),
    ]);
    if (p.data) setProfiles(p.data);
    if (w.data) setWallets(w.data);
    if (m.data) setMintOps(m.data);
    if (c.data) setCryptoTx(c.data);
    if (o.data) setOrders(o.data);
    if (t.data) setTrades(t.data);
    if (r.data) setRates(r.data);
  };

  const refresh = async () => { await fetchAll(); toast({ title: 'Refreshed' }); };

  // Admin actions
  const setMintStatus = async (id: string, status: string) => {
    const { error } = await supabase.from('mint_operations').update({ status }).eq('id', id);
    if (error) return toast({ title: 'Failed to update', variant: 'destructive' });
    toast({ title: `Mint op ${status}` });
    fetchAll();
  };

  const confirmCryptoTx = async (tx: any) => {
    const updates: any = { status: 'confirmed', confirmations: tx.required_confirmations };
    const { error } = await supabase.from('crypto_transactions').update(updates).eq('id', tx.id);
    if (error) return toast({ title: 'Failed to confirm', variant: 'destructive' });
    // credit wallet for deposit
    if (tx.type === 'deposit') {
      const { data: w } = await supabase.from('wallets').select('xafe_balance').eq('user_id', tx.user_id).maybeSingle();
      if (w) {
        await supabase.from('wallets').update({ xafe_balance: (w.xafe_balance || 0) + Number(tx.amount) }).eq('user_id', tx.user_id);
      }
    }
    toast({ title: 'Crypto tx confirmed' });
    fetchAll();
  };

  const cancelOrder = async (id: string) => {
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', id);
    if (error) return toast({ title: 'Cancel failed', variant: 'destructive' });
    toast({ title: 'Order cancelled' });
    fetchAll();
  };

  const updateRate = async (id: string, rate: number) => {
    const { error } = await supabase.from('exchange_rates').update({ rate }).eq('id', id);
    if (error) return toast({ title: 'Rate update failed', variant: 'destructive' });
    toast({ title: 'Rate updated' });
    fetchAll();
  };

  if (loading) {
    return (
      <main className="container mx-auto max-w-6xl p-4">
        <p>Loading...</p>
      </main>
    );
  }

  if (!userId || !isAdmin) {
    return (
      <main className="container mx-auto max-w-3xl p-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="h-5 w-5"/> Admin</h1>
        <p className="text-muted-foreground mb-3">Access denied. Admins only.</p>
        <Button onClick={bootstrapAdmin} variant="outline">Become Admin (first-time setup)</Button>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-7xl p-4">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="h-5 w-5"/> XAFe Admin</h1>
        <Button variant="outline" onClick={refresh}><RefreshCw className="h-4 w-4 mr-2"/>Refresh</Button>
      </header>

      <Tabs defaultValue="mint">
        <TabsList className="mb-4">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="wallets">Wallets</TabsTrigger>
          <TabsTrigger value="mint">Mint Ops</TabsTrigger>
          <TabsTrigger value="crypto">Crypto Tx</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="trades">Trades</TabsTrigger>
          <TabsTrigger value="rates">Rates</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>KYC</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.email}</TableCell>
                    <TableCell>{[p.first_name, p.last_name].filter(Boolean).join(' ')}</TableCell>
                    <TableCell>{p.kyc_status}</TableCell>
                    <TableCell>{new Date(p.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="wallets">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>XAFe</TableHead>
                  <TableHead>USDT</TableHead>
                  <TableHead>Deposited</TableHead>
                  <TableHead>Withdrawn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallets.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>{w.user_id}</TableCell>
                    <TableCell>{Number(w.xafe_balance).toLocaleString()}</TableCell>
                    <TableCell>{Number(w.usdt_balance).toFixed(2)}</TableCell>
                    <TableCell>{Number(w.total_deposited).toLocaleString()}</TableCell>
                    <TableCell>{Number(w.total_withdrawn).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="mint">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Amount (XAF)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mintOps.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.reference_id}</TableCell>
                    <TableCell className="font-mono text-xs">{m.user_id}</TableCell>
                    <TableCell>{Number(m.xaf_amount).toLocaleString()}</TableCell>
                    <TableCell>{m.status}</TableCell>
                    <TableCell className="space-x-2">
                      <Button size="sm" variant="outline" onClick={() => setMintStatus(m.id, 'verified')}><CheckCircle2 className="h-4 w-4 mr-1"/>Verify</Button>
                      <Button size="sm" variant="destructive" onClick={() => setMintStatus(m.id, 'rejected')}><XCircle className="h-4 w-4 mr-1"/>Reject</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            <TableCaption>Use Verify to approve user payments. Minting credit is handled in user flows; we can extend with a dedicated "Mint now" action.</TableCaption>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="crypto">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Network</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cryptoTx.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.type}</TableCell>
                    <TableCell className="font-mono text-xs">{c.user_id}</TableCell>
                    <TableCell>{c.network}</TableCell>
                    <TableCell>{Number(c.amount)}</TableCell>
                    <TableCell>{c.status}</TableCell>
                    <TableCell>
                      {c.status !== 'confirmed' && (
                        <Button size="sm" variant="outline" onClick={() => confirmCryptoTx(c)}>
                          Confirm
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card><CardContent className="p-4">
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
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{o.side}</TableCell>
                    <TableCell>{o.type}</TableCell>
                    <TableCell>{o.price ?? '-'}</TableCell>
                    <TableCell>{o.amount}</TableCell>
                    <TableCell>{o.status}</TableCell>
                    <TableCell>
                      {o.status === 'open' && (
                        <Button size="sm" variant="outline" onClick={() => cancelOrder(o.id)}>Cancel</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="trades">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Side</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{t.side}</TableCell>
                    <TableCell>{Number(t.price).toFixed(6)}</TableCell>
                    <TableCell>{t.amount}</TableCell>
                    <TableCell>{new Date(t.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="rates">
          <Card><CardContent className="p-4 space-y-3">
            {rates.map((er) => (
              <div key={er.id} className="flex items-center gap-2">
                <div className="w-40 font-mono text-xs">{er.from_currency} → {er.to_currency}</div>
                <Input defaultValue={er.rate} className="w-40" onBlur={(e) => updateRate(er.id, Number(e.currentTarget.value))} />
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
