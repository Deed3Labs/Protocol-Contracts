import { motion } from 'framer-motion';
import ClearPathLogo from '../assets/ClearPath-Logo.png';

export default function SplashScreen() {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-white"
    >
      {/* Unique Gradient Background */}
      <motion.div 
        className="absolute inset-0"
        style={{
          background: "linear-gradient(135deg, #ffffff 0%, #ffffff 50%, #141414 75%, #0e0e0e 100%)",
          backgroundSize: "400% 400%"
        }}
        animate={{ 
          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"]
        }}
        transition={{ 
          duration: 10, 
          ease: "easeInOut", 
          repeat: Infinity 
        }}
      />

      <motion.div
        animate={{ 
          scale: [1, 1.08, 1],
        }}
        transition={{ 
          duration: 1.2,
          ease: "easeInOut",
          repeat: Infinity,
        }}
        className="relative z-10 w-20 h-20 md:w-28 md:h-28 -mt-28 md:mt-0 rounded-2xl border border-black/90 dark:border-white/10 flex items-center justify-center overflow-hidden bg-white dark:bg-[#0e0e0e]/50 shadow-sm"
      >
          <img 
              src={ClearPathLogo} 
              alt="ClearPath" 
              className="w-full h-full object-cover" 
          />
      </motion.div>
    </motion.div>
  );
}
