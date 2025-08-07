import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useLanguage } from "@/contexts/LanguageContext";

interface PriceData {
  time: string;
  price: number;
  volume: number;
}

export const PriceChart = () => {
  const { t } = useLanguage();
  const [timeframe, setTimeframe] = useState<'1H' | '24H' | '7D' | '30D'>('24H');
  const [priceData, setPriceData] = useState<PriceData[]>([]);

  useEffect(() => {
    // Simulate price data generation
    const generatePriceData = () => {
      const now = new Date();
      const data: PriceData[] = [];
      let basePrice = 655.50; // Current USDT/XAF rate
      
      const intervals = {
        '1H': { count: 60, interval: 1 },
        '24H': { count: 24, interval: 60 },
        '7D': { count: 7, interval: 1440 },
        '30D': { count: 30, interval: 1440 }
      };

      const { count, interval } = intervals[timeframe];

      for (let i = count; i >= 0; i--) {
        const time = new Date(now.getTime() - i * interval * 60000);
        // Add some realistic price variation (±2%)
        const variation = (Math.random() - 0.5) * 0.04;
        const price = basePrice * (1 + variation);
        const volume = Math.random() * 100000 + 50000;

        data.push({
           time: timeframe === '1H' ? time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
               : timeframe === '24H' ? time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
               : time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          price: parseFloat(price.toFixed(2)),
          volume: Math.round(volume)
        });

        basePrice = price; // Use previous price as base for next point
      }

      return data;
    };

    setPriceData(generatePriceData());
  }, [timeframe]);

  const currentPrice = priceData[priceData.length - 1]?.price || 655.50;
  const previousPrice = priceData[priceData.length - 2]?.price || 655.50;
  const priceChange = ((currentPrice - previousPrice) / previousPrice * 100);
  const isPositive = priceChange >= 0;

  return (
    <Card className="animate-slide-up" style={{ animationDelay: '0.2s' }}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-heading">{t('priceChart')} — USDT/XAFe</CardTitle>
          <div className="flex gap-1">
            {(['1H', '24H', '7D', '30D'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setTimeframe(period)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  timeframe === period
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {period}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold">{currentPrice.toFixed(2)} XAFe</span>
            <span className={`text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {isPositive ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={priceData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis 
                dataKey="time" 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis 
                domain={['dataMin - 5', 'dataMax + 5']}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                }}
                formatter={(value: number) => [`${value.toFixed(2)} XAFe`, 'Price']}}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Line 
                type="monotone" 
                dataKey="price" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: 'hsl(var(--primary))' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};