import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Wallet, ArrowUpRight, Shield, Zap, Globe } from 'lucide-react';
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
      description: 'Use with MetaMask, Coinbase, or 300+ wallets'
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
      title: 'Cross-Chain',
      description: 'Access assets across multiple blockchains'
    }
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-[#0e0e0e] text-black dark:text-white font-sans relative overflow-hidden transition-colors duration-200 flex flex-col md:justify-center">
      {/* Base Background */}
      <div className="absolute inset-0 z-0 bg-white dark:bg-[#0e0e0e] transition-colors duration-200" />
      
      {/* Animated Gradient Background - Light Mode */}
      <div 
        className="absolute inset-0 z-0 dark:hidden pointer-events-none"
        style={{
          background: "linear-gradient(135deg, #0e0e0e 0%, #0e0e0e 30%, #F4F4F5 50%, #0e0e0e 70%, #0e0e0e 100%)",
          backgroundSize: "400% 400%",
          animation: "gradientFlow 20s linear infinite"
        }}
      />
      
      {/* Animated Gradient Background - Dark Mode */}
      <div 
        className="absolute inset-0 z-0 hidden dark:block pointer-events-none"
        style={{
          background: "linear-gradient(135deg, #0e0e0e 0%, #0e0e0e 30%, #F4F4F5 50%, #0e0e0e 70%, #0e0e0e 100%)",
          backgroundSize: "400% 400%",
          animation: "gradientFlow 20s linear infinite"
        }}
      />
      
      {/* Additional Water-like Flow Effect - Light Mode */}
      <motion.div 
        className="absolute inset-0 z-0 dark:hidden pointer-events-none opacity-30"
        style={{
          background: "radial-gradient(ellipse 80% 50% at 50% 50%, rgba(14, 14, 14, 0.15) 0%, transparent 70%)",
          width: "150%",
          height: "150%",
          left: "-25%",
          top: "-25%"
        }}
        animate={{ 
          x: [0, 100, 0],
          y: [0, 100, 0],
          scale: [1, 1.1, 1]
        }}
        transition={{ 
          duration: 15, 
          ease: "easeInOut", 
          repeat: Infinity 
        }}
      />
      
      {/* Additional Water-like Flow Effect - Dark Mode */}
      <motion.div 
        className="absolute inset-0 z-0 hidden dark:block pointer-events-none opacity-20"
        style={{
          background: "radial-gradient(ellipse 80% 50% at 50% 50%, rgba(255, 255, 255, 0.1) 0%, transparent 70%)",
          width: "150%",
          height: "150%",
          left: "-25%",
          top: "-25%"
        }}
        animate={{ 
          x: [0, 100, 0],
          y: [0, 100, 0],
          scale: [1, 1.1, 1]
        }}
        transition={{ 
          duration: 15, 
          ease: "easeInOut", 
          repeat: Infinity 
        }}
      />

      {/* Main Content */}
      <main className="relative z-10 pt-24 pb-28 md:pt-0 md:pb-0 container mx-auto max-w-7xl px-4 md:px-6 flex-1 flex items-center">
        <div className="w-full grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 items-center">
          
          {/* Left Column - Branding */}
          <div className="md:col-span-7 order-1">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="space-y-6"
            >
              {/* Logo */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded border border-black/90 dark:border-white/10 flex items-center justify-center overflow-hidden bg-white dark:bg-[#0e0e0e]/50 transition-colors duration-200">
                  <img src={ClearPathLogo} alt="ClearPath" className="w-full h-full object-cover" />
                </div>
                <h1 className="text-2xl md:text-3xl font-light text-black dark:text-white transition-colors duration-200">ClearPath</h1>
              </div>
              
              {/* Headline */}
              <div className="space-y-4 md:mb-3">
                <h2 className="text-4xl md:text-5xl lg:text-6xl font-light text-black dark:text-white leading-tight tracking-tight transition-colors duration-200">
                  Your Gateway to<br />
                  <span className="font-medium">Decentralized Finance</span>
                </h2>
                <p className="text-lg md:text-xl text-zinc-600 dark:text-zinc-400 max-w-xl transition-colors duration-200">
                  Connect your wallet to access tokenized assets, trading, borrowing, and more.
                </p>
              </div>
            </motion.div>
          </div>

          {/* Right Column - Connect Card */}
          <div className="md:col-span-5 order-2 md:order-2 md:mb-12">
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
              className="rounded border border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-zinc-900/20 transition-colors duration-200 relative overflow-hidden"
            >
              {/* Subtle background animation sync with gradient */}
              <motion.div
                className="absolute inset-0 opacity-0 dark:opacity-0 pointer-events-none"
                style={{
                  background: "linear-gradient(135deg, rgba(255, 255, 255, 0.3) 0%, rgba(14, 14, 14, 0.2) 50%, rgba(255, 255, 255, 0.3) 100%)",
                  backgroundSize: "400% 400%"
                }}
                animate={{
                  backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                  opacity: [0, 0.15, 0]
                }}
                transition={{
                  duration: 20,
                  ease: "linear",
                  repeat: Infinity
                }}
              />
              <motion.div
                className="absolute inset-0 opacity-0 dark:opacity-[0.1] pointer-events-none hidden dark:block"
                style={{
                  background: "linear-gradient(135deg, rgba(14, 14, 14, 0.3) 0%, rgba(255, 255, 255, 0.15) 50%, rgba(14, 14, 14, 0.3) 100%)",
                  backgroundSize: "400% 400%"
                }}
                animate={{
                  backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                  opacity: [0, 0.15, 0]
                }}
                transition={{
                  duration: 20,
                  ease: "linear",
                  repeat: Infinity
                }}
              />
              
              <div className="relative z-10">
                {/* Header */}
                <div className="p-6 pb-2">
                  <h3 className="text-2xl font-light text-zinc-900 dark:text-white tracking-tight transition-colors duration-200">
                    Connect Your Wallet
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 transition-colors duration-200">
                    Choose your preferred wallet to get started
                  </p>
                </div>

                {/* Content */}
                <div className="p-4">
                  <motion.button
                    onClick={handleConnect}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className="w-full bg-black dark:bg-white text-white dark:text-black px-6 py-4 mb-3 rounded-full text-sm font-normal hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all duration-200 flex items-center justify-center gap-3 group shadow-sm"
                  >
                    <Wallet className="w-4 h-4" />
                    <span>Connect Wallet</span>
                    <ArrowUpRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
                  </motion.button>
                </div>

                {/* Footer */}
                <div className="p-4 pt-4 border-t border-zinc-200 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/30 text-center">
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto leading-relaxed transition-colors duration-200">
                    By connecting, you agree to our Terms & Privacy Policy
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2 text-[11px] text-zinc-400 dark:text-zinc-500 transition-colors duration-200">
                    <Shield className="w-3.5 h-3.5" />
                    <span>Your keys, your money</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Features Grid - Full Width on Mobile, Part of Left Column on Desktop */}
          <div className="md:col-span-7 order-3 md:order-1 md:-mt-10">
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
                  className="p-6 rounded border cursor-pointer group relative overflow-hidden bg-zinc-50 dark:bg-zinc-900/20 border-zinc-200 dark:border-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-700"
                >
                  {/* Subtle background animation sync with gradient */}
                  <motion.div
                    className="absolute inset-0 opacity-0 dark:opacity-0 pointer-events-none"
                    style={{
                      background: "linear-gradient(135deg, rgba(255, 255, 255, 0.3) 0%, rgba(14, 14, 14, 0.2) 50%, rgba(255, 255, 255, 0.3) 100%)",
                      backgroundSize: "400% 400%"
                    }}
                    animate={{
                      backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                      opacity: [0, 0.15, 0]
                    }}
                    transition={{
                      duration: 20,
                      ease: "linear",
                      repeat: Infinity
                    }}
                  />
                  <motion.div
                    className="absolute inset-0 opacity-0 dark:opacity-[0.1] pointer-events-none hidden dark:block"
                    style={{
                      background: "linear-gradient(135deg, rgba(14, 14, 14, 0.3) 0%, rgba(255, 255, 255, 0.15) 50%, rgba(14, 14, 14, 0.3) 100%)",
                      backgroundSize: "400% 400%"
                    }}
                    animate={{
                      backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                      opacity: [0, 0.15, 0]
                    }}
                    transition={{
                      duration: 20,
                      ease: "linear",
                      repeat: Infinity
                    }}
                  />
                  <div className="relative z-10">
                    <feature.icon className="w-6 h-6 text-black dark:text-white mb-3 group-hover:scale-110 transition-transform duration-200" />
                    <h3 className="text-sm font-medium text-black dark:text-white mb-1.5 transition-colors duration-200">{feature.title}</h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed transition-colors duration-200">{feature.description}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
}
