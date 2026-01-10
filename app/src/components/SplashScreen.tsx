import { motion } from 'framer-motion';
import ClearPathLogo from '../assets/ClearPath-Logo.png';

export default function SplashScreen() {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-white dark:bg-[#0e0e0e]"
    >
      <motion.div
        animate={{ 
          scale: [1, 1.08, 1],
        }}
        transition={{ 
          duration: 1.2,
          ease: "easeInOut",
          repeat: Infinity,
        }}
        className="w-24 h-24 md:w-32 md:h-32 rounded-2xl border border-black/90 dark:border-white/10 flex items-center justify-center overflow-hidden bg-white dark:bg-[#0e0e0e]/50 shadow-sm"
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
