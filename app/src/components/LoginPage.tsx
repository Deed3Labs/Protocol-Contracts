import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Wallet, ArrowRight, Shield, Zap, Globe } from 'lucide-react';
import { useAppKitAuth } from '@/hooks/useAppKitAuth';
import { useNavigate } from 'react-router-dom';
import ClearPathLogo from '../assets/ClearPath-Logo.png';

export default function LoginPage() {
  const { isConnected, openModal } = useAppKitAuth();
  const navigate = useNavigate();
  const [hasNavigated, setHasNavigated] = useState(false);

  useEffect(() => {
    // If user is already connected, redirect to home (splash will be handled by App.tsx)
    if (isConnected && !hasNavigated) {
      setHasNavigated(true);
      // Dispatch event to trigger splash screen in App.tsx
      window.dispatchEvent(new Event('wallet-connected'));
      // Small delay before navigation to ensure splash triggers
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 100);
    } else if (!isConnected) {
      setHasNavigated(false);
    }
  }, [isConnected, navigate, hasNavigated]);

  const handleConnect = () => {
    openModal('Connect');
  };

  const features = [
    {
      icon: Wallet,
      title: 'Secure Wallets',
      description: 'Connect with MetaMask, Coinbase, or 300+ wallets'
    },
    {
      icon: Shield,
      title: 'Self-Custody',
      description: 'You control your keys and assets'
    },
    {
      icon: Zap,
      title: 'Instant Access',
      description: 'Start trading and managing assets immediately'
    },
    {
      icon: Globe,
      title: 'Multi-Chain',
      description: 'Access assets across multiple blockchains'
    }
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-[#0e0e0e] text-black dark:text-white font-sans relative overflow-hidden transition-colors duration-200">
      {/* Animated Gradient Background */}
      <motion.div 
        className="absolute inset-0 z-0"
        style={{
          background: "linear-gradient(135deg, #ffffff 0%, #f5f5f5 25%, #e5e5e5 50%, #0e0e0e 75%, #0e0e0e 100%)",
          backgroundSize: "400% 400%"
        }}
        animate={{ 
          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"]
        }}
        transition={{ 
          duration: 20, 
          ease: "linear", 
          repeat: Infinity 
        }}
      />

      {/* Main Content */}
      <main className="relative z-10 pt-24 pb-28 container mx-auto max-w-7xl md:pt-32 px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 items-center">
          
          {/* Left Column - Branding & Features */}
          <div className="md:col-span-7 space-y-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="space-y-6"
            >
              {/* Logo */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded border border-black/90 dark:border-white/10 flex items-center justify-center overflow-hidden bg-white dark:bg-[#0e0e0e]/50">
                  <img src={ClearPathLogo} alt="ClearPath" className="w-full h-full object-cover" />
                </div>
                <h1 className="text-2xl md:text-3xl font-light text-black dark:text-white">ClearPath</h1>
              </div>
              
              {/* Headline */}
              <div className="space-y-4">
                <h2 className="text-4xl md:text-5xl lg:text-6xl font-light text-black dark:text-white leading-tight tracking-tight">
                  Your Gateway to<br />
                  <span className="font-medium">Decentralized Finance</span>
                </h2>
                <p className="text-lg md:text-xl text-zinc-600 dark:text-zinc-400 max-w-xl">
                  Connect your wallet to access tokenized assets, trading, borrowing, and more.
                </p>
              </div>
            </motion.div>

            {/* Features Grid */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
              className="grid grid-cols-2 gap-4"
            >
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.3 + index * 0.1, ease: "easeOut" }}
                  whileHover={{ scale: 1.02 }}
                  className="p-6 bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer group"
                >
                  <feature.icon className="w-6 h-6 text-black dark:text-white mb-3 group-hover:scale-110 transition-transform" />
                  <h3 className="text-sm font-medium text-black dark:text-white mb-1.5">{feature.title}</h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{feature.description}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>

          {/* Right Column - Connect Card */}
          <div className="md:col-span-5">
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
              className="bg-zinc-50 dark:bg-zinc-900/20 rounded border border-zinc-200 dark:border-zinc-800/50 p-8 md:p-10 space-y-8"
            >
              <div className="space-y-3">
                <h3 className="text-2xl md:text-3xl font-light text-black dark:text-white">
                  Connect Your Wallet
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Choose your preferred wallet to get started
                </p>
              </div>

              <motion.button
                onClick={handleConnect}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full bg-black dark:bg-white text-white dark:text-black px-6 py-4 rounded-full text-base font-normal hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 group shadow-sm"
              >
                <Wallet className="w-5 h-5" />
                <span>Connect Wallet</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </motion.button>

              <div className="pt-6 border-t border-zinc-200 dark:border-zinc-800/50 space-y-4">
                <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center leading-relaxed">
                  By connecting, you agree to ClearPath's Terms of Service and Privacy Policy
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-zinc-400">
                  <Shield className="w-4 h-4" />
                  <span>Your keys, your crypto</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
}
