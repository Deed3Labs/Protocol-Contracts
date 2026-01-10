import { motion } from 'framer-motion';
import ClearPathLogo from '../assets/ClearPath-Logo.png';

export default function SplashScreen() {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0e0e0e] overflow-hidden"
    >
      {/* Animated Gradient Background */}
      <motion.div 
        className="absolute inset-0 opacity-30"
        style={{
          background: "linear-gradient(-45deg, #1d4ed8, #7e22ce, #be185d, #1d4ed8)",
          backgroundSize: "400% 400%"
        }}
        animate={{ 
          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"]
        }}
        transition={{ 
          duration: 6, 
          ease: "linear", 
          repeat: Infinity 
        }}
      />
      
      {/* Radial overlay for depth */}
      <div className="absolute inset-0 bg-radial-gradient from-transparent to-[#0e0e0e] opacity-80" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        <motion.div
          initial={{ scale: 0.8, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ 
            duration: 1.2,
            type: "spring",
            bounce: 0.4
          }}
          className="relative"
        >
          {/* Glow effect behind logo */}
          <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full transform scale-150 animate-pulse" />
          
          <div className="w-32 h-32 md:w-40 md:h-40 bg-black/40 backdrop-blur-xl rounded-3xl border border-white/10 shadow-2xl flex items-center justify-center p-6 relative">
              <img 
                  src={ClearPathLogo} 
                  alt="ClearPath" 
                  className="w-full h-full object-contain drop-shadow-xl" 
              />
          </div>
        </motion.div>

        {/* Loading Bar */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="w-48 h-1 bg-zinc-800 rounded-full overflow-hidden"
        >
          <motion.div 
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 2.5, ease: "easeInOut" }}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}
