import { motion } from 'framer-motion';
import ClearPathLogo from '../assets/ClearPath-Logo.png';

export default function SplashScreen() {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-white dark:bg-[#0e0e0e]"
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
        className="relative z-10 w-20 h-20 md:w-28 md:h-28 -mt-26 md:mt-0 rounded-2xl border border-black/90 dark:border-white/10 flex items-center justify-center overflow-hidden bg-white dark:bg-[#0e0e0e]/50 shadow-sm"
      >
          <img 
              src={ClearPathLogo} 
              alt="ClearPath" 
              className="w-full h-full object-cover" 
          />
      </motion.div>
      
      {/* Footer Text */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.5 }}
        className="absolute bottom-8 md:bottom-12 left-0 right-0 text-center text-black dark:text-white font-bold tracking-wider text-lg md:text-xl"
      >
        ClearPath
      </motion.p>
    </motion.div>
  );
}
