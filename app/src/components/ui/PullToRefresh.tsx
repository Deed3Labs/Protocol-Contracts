import { useState, useEffect, useRef } from 'react';
import { motion, useAnimation, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  initialLoading?: boolean;
}

const Skeleton = () => (
  <div className="container mx-auto max-w-7xl pt-24 px-4 md:px-6">
    <div className="animate-pulse space-y-8">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 md:gap-0">
        <div className="space-y-3 w-full md:w-auto">
          <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-32"></div>
          <div className="h-10 bg-zinc-100 dark:bg-zinc-800 rounded w-full md:w-64"></div>
        </div>
        <div className="flex gap-3 self-end md:self-auto">
          <div className="h-10 bg-zinc-100 dark:bg-zinc-800 rounded-full w-24"></div>
          <div className="h-10 bg-zinc-100 dark:bg-zinc-800 rounded-full w-24"></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-zinc-100 dark:border-zinc-800 pb-4">
         {[1,2,3,4].map(i => (
           <div key={i} className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-20"></div>
         ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Main Content */}
        <div className="md:col-span-8 space-y-6">
           <div className="h-64 bg-zinc-100 dark:bg-zinc-800 rounded-xl w-full"></div>
           <div className="space-y-4">
              {[1,2,3].map(i => (
                <div key={i} className="h-16 bg-zinc-100 dark:bg-zinc-800 rounded-lg w-full"></div>
              ))}
           </div>
        </div>
        
        {/* Sidebar */}
        <div className="md:col-span-4 space-y-6 hidden md:block">
           <div className="h-40 bg-zinc-100 dark:bg-zinc-800 rounded-xl w-full"></div>
           <div className="h-64 bg-zinc-100 dark:bg-zinc-800 rounded-xl w-full"></div>
        </div>
      </div>
    </div>
  </div>
);

export default function PullToRefresh({ onRefresh, children, initialLoading = false }: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(initialLoading);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const controls = useAnimation();
  const y = useMotionValue(0);
  
  // Handle initial loading trigger
  useEffect(() => {
    if (initialLoading) {
      setIsRefreshing(true);
      // Simulate loading delay then turn off, NO reload call
      const timer = setTimeout(() => {
        setIsRefreshing(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [initialLoading]);
  
  // Transform y value to rotation for the spinner
  const rotate = useTransform(y, [0, 100], [0, 360]);
  const opacity = useTransform(y, [0, 50], [0, 1]);

  // Fix for fixed position elements: only apply transform when actively pulling/refreshing
  const transform = useTransform(y, (latest) => {
    if (latest === 0 && !isRefreshing) return "none";
    return `translateY(${latest}px)`;
  });
  
  const MAX_PULL = 150;
  const THRESHOLD = 80;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Use unified pointer events to handle both mouse (desktop) and touch (mobile)
    const handleStart = (e: TouchEvent | MouseEvent) => {
      // Only enable if we're at the top of the page
      if (window.scrollY <= 5) {
        startY.current = 'touches' in e ? e.touches[0].clientY : e.clientY;
        // Only trigger on mouse drag if mouse button is down
        if ('button' in e && e.button !== 0) return;
        isDragging.current = true;
      }
    };

    const handleMove = (e: TouchEvent | MouseEvent) => {
      if (!isDragging.current || window.scrollY > 5 || isRefreshing) return;

      const currentY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const diff = currentY - startY.current;

      if (diff > 0) {
        const newY = Math.min(diff * 0.5, MAX_PULL);
        y.set(newY);
        // Prevent default behavior (scroll/selection) when actively pulling
        if (e.cancelable) e.preventDefault();
      } else {
        isDragging.current = false;
      }
    };

    const handleEnd = async () => {
      if (!isDragging.current || isRefreshing) return;
      isDragging.current = false;

      const currentY = y.get();

      if (currentY > THRESHOLD) {
        setIsRefreshing(true);
        // Rubber band back to 0 immediately with a spring animation
        await controls.start({ 
          y: 0,
          transition: { type: "spring", stiffness: 300, damping: 30 }
        });
        y.set(0);
        
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
          controls.start({ y: 0 });
          y.set(0);
        }
      } else {
        // Snap back if not passed threshold
        controls.start({ 
          y: 0,
          transition: { type: "spring", stiffness: 300, damping: 30 }
        });
        y.set(0);
      }
    };

    // Trackpad Support (Wheel Event)
    let wheelTimeout: NodeJS.Timeout;
    const handleWheel = (e: WheelEvent) => {
      // Allow default scroll if we're not at the top or if the user is scrolling down
      if (window.scrollY > 5 || isRefreshing) return;

      // Check if it's a vertical pull (negative deltaY at top)
      // Note: Trackpads often send very small deltaY values
      if ((e.deltaY < 0 && window.scrollY <= 5) || (y.get() > 0 && e.deltaY < 0)) {
        // Prevent native browser history navigation / overscroll bounce
        if (e.cancelable) e.preventDefault();
        
        const currentY = y.get();
        // Accumulate pull (simulating drag)
        const newY = Math.min(currentY + Math.abs(e.deltaY) * 0.5, MAX_PULL);
        
        if (newY > 0) {
           y.set(newY);
           // Debounce the "end" of the gesture
           clearTimeout(wheelTimeout);
           wheelTimeout = setTimeout(() => {
             const finalY = y.get();
             if (finalY > THRESHOLD) {
               // Trigger refresh logic
               setIsRefreshing(true);
               controls.start({ 
                 y: 0,
                 transition: { type: "spring", stiffness: 300, damping: 30 }
               }).then(async () => {
                 try {
                   await onRefresh();
                 } finally {
                   setIsRefreshing(false);
                   y.set(0);
                 }
               });
             } else {
               controls.start({ 
                 y: 0,
                 transition: { type: "spring", stiffness: 300, damping: 30 }
               });
               y.set(0);
             }
           }, 150); // Wait for wheel events to stop
        }
      } else if (y.get() > 0 && e.deltaY > 0) {
         // If pulling and user scrolls down, reduce pull
         const currentY = y.get();
         const newY = Math.max(0, currentY - e.deltaY);
         y.set(newY);
         if (e.cancelable) e.preventDefault();
         
         clearTimeout(wheelTimeout);
         wheelTimeout = setTimeout(() => {
            if (y.get() > 0 && !isRefreshing) {
                controls.start({ y: 0, transition: { type: "spring", stiffness: 300, damping: 30 } });
                y.set(0);
            }
         }, 150);
      }
    };

    window.addEventListener('touchstart', handleStart, { passive: true });
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
    
    // Desktop Mouse Events
    window.addEventListener('mousedown', handleStart);
    window.addEventListener('mousemove', handleMove); // Keep passive: true default for mouse unless prevented? 
    // Actually for mousemove we generally don't need passive: false unless preventing default.
    // We added preventDefault above, so we should treat it as non-passive in logic if needed, 
    // but addEventListener defaults to passive: false for mousemove in most browsers or is neutral.
    // However, to be safe and explicit:
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('mouseleave', handleEnd);

    // Trackpad Wheel Event - passive: false is REQUIRED to prevent default
    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('touchstart', handleStart);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
      
      window.removeEventListener('mousedown', handleStart);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('mouseleave', handleEnd);

      window.removeEventListener('wheel', handleWheel);
    };
  }, [isRefreshing, onRefresh, controls, y]);

  return (
    <div ref={containerRef} className="relative min-h-screen">
      {/* Loading Indicator Layer */}
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
        style={{ transform }} 
        className="relative z-10 transition-transform duration-200 bg-white dark:bg-[#0e0e0e] min-h-screen"
      >
        <AnimatePresence>
          {isRefreshing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 z-50 bg-white dark:bg-[#0e0e0e]"
            >
              <Skeleton />
            </motion.div>
          )}
        </AnimatePresence>
        {children}
      </motion.div>
    </div>
  );
}
