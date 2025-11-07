import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  Eye, 
  EyeOff, 
  Mail, 
  Phone, 
  ArrowRight, 
  Shield,
  Smartphone,
  Check,
  Star,
  Loader2
} from "lucide-react";
import xafeLogo from "@/assets/xafe-logo.png";

interface AuthProps {
  onAuthSuccess: (user: User, session: Session) => void;
}

export const AuthComponent = ({ onAuthSuccess }: AuthProps) => {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    firstName: "",
    lastName: ""
  });
  const { toast } = useToast();

  useEffect(() => {
    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        onAuthSuccess(session.user, session);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          onAuthSuccess(session.user, session);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [onAuthSuccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isForgotPassword) {
        // Password reset flow
        const { error } = await supabase.auth.resetPasswordForEmail(formData.email, {
          redirectTo: `${window.location.origin}/`,
        });

        if (error) {
          toast({
            title: "Erreur",
            description: error.message,
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Email envoyé",
          description: "Vérifiez votre boîte mail pour réinitialiser votre mot de passe",
        });
        setIsForgotPassword(false);
        setIsLogin(true);
      } else if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password,
        });

        if (error) {
          toast({
            title: "Erreur de connexion",
            description: error.message,
            variant: "destructive",
          });
          return;
        }

        if (data.user && data.session) {
          toast({
            title: "Connecté",
            description: "Bienvenue sur XAFe App!",
          });
          onAuthSuccess(data.user, data.session);
        }
      } else {
        // Sign up
        if (formData.password !== formData.confirmPassword) {
          toast({
            title: "Erreur",
            description: "Les mots de passe ne correspondent pas",
            variant: "destructive",
          });
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              first_name: formData.firstName,
              last_name: formData.lastName,
              phone: formData.phone,
            }
          }
        });

        if (error) {
          toast({
            title: "Erreur d'inscription",
            description: error.message,
            variant: "destructive",
          });
          return;
        }

        if (data.user) {
          toast({
            title: "Compte créé",
            description: "Votre compte a été créé. Votre portefeuille est prêt!",
          });
          
          // If user is confirmed, sign them in immediately
          if (data.session) {
            onAuthSuccess(data.user, data.session);
          }
        }
      }
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Une erreur inattendue s'est produite",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: Shield, text: "Enhanced security with 2FA" },
    { icon: Smartphone, text: "Compatible with Mobile Money + Banks" },
    { icon: Star, text: "Reduced fees for CEMAC" }
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
              <p className="text-lg text-muted-foreground">The future of payments in Africa</p>
            </div>
          </div>
          
          <div className="space-y-4">
            <h2 className="text-2xl font-heading font-bold text-foreground">
              Your XAFe stablecoin on blockchain
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Buy, store and exchange XAFe with cryptocurrencies.
              Compatible with MTN MoMo, Orange Money and all banks in Cameroon and CEMAC.
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
              🔐 Simplified KYC
            </Badge>
            <Badge variant="secondary" className="bg-xafe-blue/20 text-xafe-blue">
              ⚡ Instant
            </Badge>
            <Badge variant="secondary" className="bg-xafe-orange/20 text-xafe-orange">
              💰 Fees 0.1%
            </Badge>
          </div>
        </div>

        {/* Right Side - Auth Form */}
        <Card className="balance-card border-xafe-green/20 animate-scale-in">
          <CardHeader className="text-center pb-8">
            <CardTitle className="text-2xl font-heading font-bold">
              {isForgotPassword ? "Réinitialiser le mot de passe" : isLogin ? "Connexion" : "Créer un compte"}
            </CardTitle>
            <p className="text-muted-foreground">
              {isForgotPassword 
                ? "Entrez votre email pour recevoir un lien de réinitialisation"
                : isLogin 
                  ? "Accédez à votre portefeuille XAFe" 
                  : "Rejoignez la révolution crypto africaine"
              }
            </p>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              
              {/* First Name & Last Name (for signup) */}
              {!isLogin && !isForgotPassword && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="font-heading font-semibold">First name</Label>
                    <Input
                      id="firstName"
                      type="text"
                      placeholder="John"
                      value={formData.firstName}
                      onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                      className="h-12 bg-secondary/10 border-white/10 font-heading"
                      required={!isLogin}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName" className="font-heading font-semibold">Last name</Label>
                    <Input
                      id="lastName"
                      type="text"
                      placeholder="Doe"
                      value={formData.lastName}
                      onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                      className="h-12 bg-secondary/10 border-white/10 font-heading"
                      required={!isLogin}
                    />
                  </div>
                </div>
              )}

              {/* Email Input */}
              <div className="space-y-2">
                <Label htmlFor="email" className="font-heading font-semibold">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="pl-10 h-12 bg-secondary/10 border-white/10 font-heading"
                    required
                  />
                </div>
              </div>

              {/* Phone Input (for signup) */}
              {!isLogin && !isForgotPassword && (
                <div className="space-y-2">
                  <Label htmlFor="phone" className="font-heading font-semibold">
                    Phone <Badge variant="secondary" className="ml-2 text-xs">MoMo + Bank</Badge>
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
                    />
                  </div>
                </div>
              )}

              {/* Password Input */}
              {!isForgotPassword && (
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
                {isLogin && (
                  <div className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setIsForgotPassword(true);
                        setIsLogin(false);
                      }}
                      className="text-xs text-muted-foreground hover:text-xafe-green p-0 h-auto font-heading"
                    >
                      Mot de passe oublié ?
                    </Button>
                  </div>
                )}
              </div>
              )}

              {/* Confirm Password (for signup) */}
              {!isLogin && !isForgotPassword && (
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="font-heading font-semibold">Confirm password</Label>
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
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    {isForgotPassword ? "Envoi..." : isLogin ? "Connexion..." : "Création..."}
                  </>
                ) : (
                  <>
                    {isForgotPassword ? "Envoyer le lien" : isLogin ? "Se connecter" : "Créer mon compte"}
                    <ArrowRight className="h-5 w-5 ml-2" />
                  </>
                )}
              </Button>
            </form>

            {/* Toggle Login/Signup */}
            <div className="text-center">
              {!isForgotPassword ? (
                <>
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
                </>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIsForgotPassword(false);
                    setIsLogin(true);
                  }}
                  className="font-heading font-semibold text-xafe-green hover:text-xafe-green"
                >
                  Retour à la connexion
                </Button>
              )}
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