import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  Eye, 
  EyeOff, 
  Mail, 
  Phone, 
  ArrowRight, 
  Shield,
  Smartphone,
  Check,
  Star
} from "lucide-react";
import xafeLogo from "@/assets/xafe-logo.png";

interface AuthProps {
  onLogin: () => void;
}

export const AuthComponent = ({ onLogin }: AuthProps) => {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    phone: "",
    password: "",
    confirmPassword: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate authentication
    setTimeout(() => {
      onLogin();
    }, 1500);
  };

  const features = [
    { icon: Shield, text: "Sécurité renforcée avec 2FA" },
    { icon: Smartphone, text: "Compatible Mobile Money + Banques" },
    { icon: Star, text: "Frais réduits pour CEMAC" }
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        
        {/* Left Side - Branding */}
        <div className="space-y-8 text-center lg:text-left animate-fade-in">
          <div className="flex items-center justify-center lg:justify-start gap-4">
            <img src={xafeLogo} alt="XAFe" className="w-16 h-16 rounded-2xl animate-float" />
            <div>
              <h1 className="text-4xl font-heading font-bold text-foreground">XAFe App</h1>
              <p className="text-lg text-muted-foreground">L'avenir des paiements en Afrique</p>
            </div>
          </div>
          
          <div className="space-y-4">
            <h2 className="text-2xl font-heading font-bold text-foreground">
              Votre stablecoin XAF sur blockchain
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Achetez, stockez et échangez des XAFe contre des cryptomonnaies. 
              Compatible avec MTN MoMo, Orange Money et toutes les banques pour le Cameroun et la CEMAC.
            </p>
          </div>

          <div className="space-y-4">
            {features.map((feature, index) => {
              const IconComponent = feature.icon;
              return (
                <div 
                  key={index} 
                  className="flex items-center gap-3 p-4 bg-gradient-card rounded-xl border border-xafe-green/20 hover-lift"
                  style={{ animationDelay: `${0.2 * index}s` }}
                >
                  <div className="w-10 h-10 bg-gradient-primary rounded-xl flex items-center justify-center">
                    <IconComponent className="h-5 w-5 text-white" />
                  </div>
                  <span className="font-heading font-semibold text-foreground">{feature.text}</span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-center lg:justify-start gap-4">
            <Badge variant="secondary" className="bg-xafe-green/20 text-xafe-green">
              🔐 KYC Simplifié
            </Badge>
            <Badge variant="secondary" className="bg-xafe-blue/20 text-xafe-blue">
              ⚡ Instantané
            </Badge>
            <Badge variant="secondary" className="bg-xafe-orange/20 text-xafe-orange">
              💰 Frais 0.1%
            </Badge>
          </div>
        </div>

        {/* Right Side - Auth Form */}
        <Card className="balance-card border-xafe-green/20 animate-scale-in">
          <CardHeader className="text-center pb-8">
            <CardTitle className="text-2xl font-heading font-bold">
              {isLogin ? "Connexion" : "Créer un compte"}
            </CardTitle>
            <p className="text-muted-foreground">
              {isLogin 
                ? "Accédez à votre portefeuille XAFe" 
                : "Rejoignez la révolution crypto africaine"
              }
            </p>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              
              {/* Email Input */}
              <div className="space-y-2">
                <Label htmlFor="email" className="font-heading font-semibold">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="votre@email.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="pl-10 h-12 bg-secondary/10 border-white/10 font-heading"
                    required
                  />
                </div>
              </div>

              {/* Phone Input (for signup) */}
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="phone" className="font-heading font-semibold">
                    Téléphone <Badge variant="secondary" className="ml-2 text-xs">MoMo + Banque</Badge>
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="+237 6XX XXX XXX"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="pl-10 h-12 bg-secondary/10 border-white/10 font-heading"
                      required={!isLogin}
                    />
                  </div>
                </div>
              )}

              {/* Password Input */}
              <div className="space-y-2">
                <Label htmlFor="password" className="font-heading font-semibold">Mot de passe</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="pr-10 h-12 bg-secondary/10 border-white/10 font-heading"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 h-8 w-8"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Confirm Password (for signup) */}
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="font-heading font-semibold">Confirmer le mot de passe</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    className="h-12 bg-secondary/10 border-white/10 font-heading"
                    required={!isLogin}
                  />
                </div>
              )}

              {/* Submit Button */}
              <Button 
                type="submit" 
                variant="xafe" 
                size="xl" 
                className="w-full action-button font-heading font-bold"
              >
                {isLogin ? "Se connecter" : "Créer mon compte"}
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </form>

            {/* Toggle Login/Signup */}
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                {isLogin ? "Pas encore de compte ?" : "Déjà un compte ?"}
              </p>
              <Button
                variant="ghost"
                onClick={() => setIsLogin(!isLogin)}
                className="font-heading font-semibold text-xafe-green hover:text-xafe-green"
              >
                {isLogin ? "Créer un compte" : "Se connecter"}
              </Button>
            </div>

            {/* Security Notice */}
            <div className="text-center p-4 bg-gradient-primary/10 rounded-xl border border-xafe-green/20">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Shield className="h-4 w-4 text-xafe-green" />
                <span className="text-sm font-heading font-semibold text-xafe-green">100% Sécurisé</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Vos clés privées sont stockées localement. Nous ne collectons que les données nécessaires.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};