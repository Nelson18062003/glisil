import React, { createContext, useContext, useState, ReactNode } from 'react';

export type Language = 'fr' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations = {
  fr: {
    // Navigation
    'wallet': 'Portefeuille',
    'market': 'Marché',
    'transactions': 'Transactions',
    'profile': 'Profil',
    
    // Wallet
    'totalBalance': 'Solde total',
    'xafeBalance': 'Solde XAFe',
    'usdtBalance': 'Solde USDT',
    'quickActions': 'Actions rapides',
    'depositXafe': 'Déposer des XAFe',
    'withdrawXafe': 'Retirer des XAFe',
    'createXafe': 'Créer des XAFe',
    'exchangeXafe': 'Échanger XAFe → XAF',
    'recentActivity': 'Activité récente',
    'viewAll': 'Voir tout',
    
    // Market
    'marketOverview': 'Vue d\'ensemble du marché',
    'exchangeRate': 'Taux de change',
    'priceChart': 'Graphique des prix',
    'tradingVolume': '24h',
    'priceChange': 'Variation',
    'marketCap': 'Cap. marché',
    'convert': 'Convertir',
    'from': 'De',
    'to': 'Vers',
    'amount': 'Montant',
    'exchangeNow': 'Échanger maintenant',
    
    // Transactions
    'transactionHistory': 'Historique des transactions',
    'pendingStatus': 'En attente',
    'completed': 'Terminé',
    'failed': 'Échoué',
    'deposit': 'Dépôt',
    'withdrawal': 'Retrait',
    'exchange': 'Échange',
    'mobileMoneyDeposit': 'Dépôt Mobile Money',
    
    // Profile
    'userProfile': 'Profil utilisateur',
    'personalInformation': 'Informations personnelles',
    'fullName': 'Nom complet',
    'email': 'Email',
    'phone': 'Téléphone',
    'dateOfBirth': 'Date de naissance',
    'kycStatus': 'Statut KYC',
    'verified': 'Vérifié',
    'pending': 'En attente',
    'notVerified': 'Non vérifié',
    'accountSettings': 'Paramètres du compte',
    'changePassword': 'Changer le mot de passe',
    'twoFactorAuth': '2FA',
    'notifications': 'Notifications',
    'language': 'Langue',
    
    // Common
    'success': 'Succès',
    'error': 'Erreur',
    'loading': 'Chargement...',
    'save': 'Sauvegarder',
    'cancel': 'Annuler',
    'confirm': 'Confirmer',
    'close': 'Fermer',
  },
  en: {
    // Navigation
    'wallet': 'Wallet',
    'market': 'Market',
    'transactions': 'Transactions',
    'profile': 'Profile',
    
    // Wallet
    'totalBalance': 'Total Balance',
    'xafeBalance': 'XAFe Balance',
    'usdtBalance': 'USDT Balance',
    'quickActions': 'Quick Actions',
    'depositXafe': 'Deposit XAFe',
    'withdrawXafe': 'Withdraw XAFe',
    'createXafe': 'Create XAFe',
    'exchangeXafe': 'Exchange XAFe → XAF',
    'recentActivity': 'Recent Activity',
    'viewAll': 'View All',
    
    // Market
    'marketOverview': 'Market Overview',
    'exchangeRate': 'Exchange Rate',
    'priceChart': 'Price Chart',
    'tradingVolume': '24h Volume',
    'priceChange': 'Price Change',
    'marketCap': 'Market Cap',
    'convert': 'Convert',
    'from': 'From',
    'to': 'To',
    'amount': 'Amount',
    'exchangeNow': 'Exchange Now',
    
    // Transactions
    'transactionHistory': 'Transaction History',
    'pendingStatus': 'Pending',
    'completed': 'Completed',
    'failed': 'Failed',
    'deposit': 'Deposit',
    'withdrawal': 'Withdrawal',
    'exchange': 'Exchange',
    'mobileMoneyDeposit': 'Mobile Money Deposit',
    
    // Profile
    'userProfile': 'User Profile',
    'personalInformation': 'Personal Information',
    'fullName': 'Full Name',
    'email': 'Email',
    'phone': 'Phone',
    'dateOfBirth': 'Date of Birth',
    'kycStatus': 'KYC Status',
    'verified': 'Verified',
    'pending': 'Pending',
    'notVerified': 'Not Verified',
    'accountSettings': 'Account Settings',
    'changePassword': 'Change Password',
    'twoFactorAuth': 'Two-Factor Auth',
    'notifications': 'Notifications',
    'language': 'Language',
    
    // Common
    'success': 'Success',
    'error': 'Error',
    'loading': 'Loading...',
    'save': 'Save',
    'cancel': 'Cancel',
    'confirm': 'Confirm',
    'close': 'Close',
  }
};

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>('en');

  const t = (key: string): string => {
    return translations[language][key as keyof typeof translations['fr']] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};