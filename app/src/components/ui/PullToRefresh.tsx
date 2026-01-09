import { useState, useEffect, useRef } from 'react';
import { motion, useAnimation, useMotionValue, useTransform } from 'framer-motion';
import { Loader2 } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

export default function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const controls = useAnimation();
  const y = useMotionValue(0);
  
  // Transform y value to rotation for the spinner
  const rotate = useTransform(y, [0, 100], [0, 360]);
  const opacity = useTransform(y, [0, 50], [0, 1]);
  
  const MAX_PULL = 150;
  const THRESHOLD = 80;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Only enable if we're at the top of the page
      if (window.scrollY <= 5) { // Small buffer
        startY.current = e.touches[0].clientY;
        isDragging.current = true;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging.current || window.scrollY > 5 || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - startY.current;

      if (diff > 0) {
        // Add resistance
        const newY = Math.min(diff * 0.5, MAX_PULL);
        y.set(newY);
        
        // Prevent default to stop native rubber banding
        if (e.cancelable) e.preventDefault();
      } else {
        // If pushing up, stop dragging logic to allow scroll
        isDragging.current = false;
      }
    };

    const handleTouchEnd = async () => {
      if (!isDragging.current || isRefreshing) return;
      isDragging.current = false;

      const currentY = y.get();

      if (currentY > THRESHOLD) {
        setIsRefreshing(true);
        // Animate to threshold
        await controls.start({ y: THRESHOLD });
        
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
          // Animate back to 0
          controls.start({ y: 0 });
          y.set(0);
        }
      } else {
        // Animate back to 0
        controls.start({ y: 0 });
        y.set(0);
      }
    };

    // Attach to window to catch pulls even if starting on fixed elements
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isRefreshing, onRefresh, controls, y]);

  // Sync motion value with animation controls
  useEffect(() => {
    const unsubscribe = y.on("change", () => {
       // Only manually set if not animating via controls
    });
    return unsubscribe;
  }, [y]);

  return (
    <div ref={containerRef} className="relative min-h-screen">
      {/* Loading Indicator Layer - Positioned below header (approx 80px) */}
      <div className="absolute top-24 left-0 right-0 flex justify-center z-0 pointer-events-none">
        <motion.div 
          style={{ opacity, rotate, scale: opacity }}
          className="bg-white dark:bg-zinc-800 rounded-full p-2.5 shadow-xl border border-zinc-200 dark:border-zinc-700"
        >
          <Loader2 className={`w-6 h-6 text-black dark:text-white ${isRefreshing ? 'animate-spin' : ''}`} />
        </motion.div>
      </div>

      {/* Content Layer */}
      <motion.div 
        animate={controls}
        style={{ y: isRefreshing ? undefined : y }} 
        className="relative z-10 transition-transform duration-200 bg-white dark:bg-[#0e0e0e]"
      >
        {children}
      </motion.div>
    </div>
  );
}
