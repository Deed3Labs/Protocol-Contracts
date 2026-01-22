import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import SearchBar from './SearchBar';
import SearchResults from './SearchResults';
import { useModal } from '@/context/ModalContext';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedCategories: string[];
  onCategoryToggle: (category: string) => void;
  filterCategories: string[];
}

export default function SearchModal({
  isOpen,
  onClose,
  searchQuery,
  onSearchChange,
  selectedCategories,
  onCategoryToggle,
  filterCategories,
}: SearchModalProps) {
  const { setModalOpen } = useModal();
  const [isDragging, setIsDragging] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const y = useMotionValue(0);
  const x = useMotionValue(0);
  
  // Update modal context when modal opens/closes
  useEffect(() => {
    setModalOpen(isOpen);
  }, [isOpen, setModalOpen]);
  
  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  // Calculate opacity and scale based on drag distance (for visual feedback)
  // On mobile, use horizontal (x) drag; on desktop, use vertical (y) drag
  const yOpacity = useTransform(y, [0, 300], [1, 0]);
  const yScale = useTransform(y, [0, 300], [1, 0.9]);
  const xOpacity = useTransform(x, [-300, 0, 300], [0, 1, 0]);
  const xScale = useTransform(x, [-300, 0, 300], [0.9, 1, 0.9]);
  
  // Use appropriate transform based on device
  const opacity = isMobile ? xOpacity : yOpacity;
  const scale = isMobile ? xScale : yScale;

  // Handle Escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  // Reset motion values when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      y.set(0);
      x.set(0);
    }
  }, [isOpen, y, x]);

  const handleDragEnd = (_event: any, info: any) => {
    setIsDragging(false);
    const threshold = 100; // Minimum drag distance to close
    
    if (isMobile) {
      // On mobile: only check horizontal (left/right) drag
      if (Math.abs(info.offset.x) > threshold) {
        onClose();
        return;
      }
      // Reset horizontal position if not dragged enough
      x.set(0);
    } else {
      // On desktop: check vertical (down) drag
      if (info.offset.y > threshold) {
        onClose();
        return;
      }
      // Reset vertical position if not dragged enough
      y.set(0);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm z-[100]"
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: isDragging ? undefined : 1, y: isDragging ? undefined : 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="fixed inset-0 z-[101] flex flex-col bg-white dark:bg-[#0e0e0e]"
            style={{ 
              paddingTop: 'env(safe-area-inset-top)',
              y: isMobile ? 0 : y,
              x: isMobile ? x : 0,
              opacity: isDragging ? opacity : undefined,
              scale: isDragging ? scale : undefined,
            }}
            drag={isMobile ? "x" : "y"}
            dragConstraints={isMobile ? { left: 0, right: 0 } : { top: 0, bottom: 0 }}
            dragElastic={0.2}
            dragDirectionLock
            onDragStart={() => setIsDragging(true)}
            onDragEnd={handleDragEnd}
            dragMomentum={false}
          >
            {/* Header */}
            <div className="border-b border-zinc-200 dark:border-zinc-800 px-3 py-3 pt-2 md:px-6 md:py-4">
              <div className="container mx-auto max-w-4xl flex items-start md:items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <SearchBar
                    searchQuery={searchQuery}
                    onSearchChange={onSearchChange}
                    selectedCategories={selectedCategories}
                    onCategoryToggle={onCategoryToggle}
                    filterCategories={filterCategories}
                    placeholder="Search assets, symbols, news..."
                  />
                </div>
                <button
                  onClick={onClose}
                  className="hidden md:flex flex-shrink-0 p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded transition-colors ml-4"
                  aria-label="Close search"
                >
                  <X className="w-5 h-5 text-black dark:text-white" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <div 
                className="container mx-auto max-w-4xl px-4 py-4 md:px-6 md:py-6"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
              >
                {searchQuery ? (
                  <SearchResults 
                    query={searchQuery} 
                    selectedCategories={selectedCategories}
                  />
                ) : (
                  <div className="py-12 md:py-16 text-center">
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm">
                      Start typing to search...
                    </p>
                    <p className="text-zinc-400 dark:text-zinc-500 text-xs mt-2">
                      <span className="hidden md:inline">Press <kbd className="px-2 py-1 bg-zinc-100 dark:bg-zinc-900 rounded text-xs">Esc</kbd> to close</span>
                      <span className="md:hidden">Swipe to close</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
