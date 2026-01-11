import React, { useState } from 'react';
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';

interface CTAData {
  id: string;
  title: string;
  description: string;
  buttonText: string;
  notificationCount?: number;
  gradient: string;
  renderGraphic: () => React.ReactNode;
}

const initialCards: CTAData[] = [
  {
    id: 'hysa',
    title: 'High-Yield Savings.',
    description: 'Register to earn upto 17.5% APY with our High-Yield Savings Account.',
    buttonText: 'Get started',
    notificationCount: 2,
    gradient: 'from-zinc-100 via-zinc-100 to-blue-50 dark:from-zinc-900 dark:via-zinc-900 dark:to-blue-900/30',
    renderGraphic: () => (
      <div className="absolute right-4 bottom-0.5 opacity-60 pointer-events-none">
        <div className="text-lg text-blue-500/10 dark:text-blue-400/10 -mt-2 text-left">upto</div>
        <div className="text-6xl font-bold text-blue-500/10 dark:text-blue-400/10">17.5%</div>
        <div className="text-lg text-blue-500/10 dark:text-blue-400/10 -mt-2 text-right">APY</div>
      </div>
    )
  },
  {
    id: 'ira',
    title: 'Your 1% IRA match is waiting',
    description: 'Finish setting up your IRA and start investing for retirement with 1% match on your annual contributions.',
    buttonText: 'Finish account setup',
    notificationCount: 1,
    gradient: 'from-zinc-100 via-zinc-100 to-purple-50 dark:from-zinc-900 dark:via-zinc-900 dark:to-purple-900/30',
    renderGraphic: () => (
      <div className="absolute right-4 bottom-0 opacity-60 pointer-events-none">
        <div className="text-6xl font-bold text-purple-500/10 dark:text-purple-400/10">1%</div>
        <div className="text-xl text-purple-500/10 dark:text-purple-400/10 -mt-2 text-right">match</div>
      </div>
    )
  },
  {
    id: 'crypto-bonus',
    title: 'Claim your crypto bonus',
    description: 'Deposit $100+ in crypto this week and get a $10 bonus in ETH.',
    buttonText: 'Deposit now',
    gradient: 'from-zinc-100 via-zinc-100 to-emerald-50 dark:from-zinc-900 dark:via-zinc-900 dark:to-emerald-900/30',
    renderGraphic: () => (
      <div className="absolute right-4 bottom-4 opacity-60 pointer-events-none">
        <div className="text-5xl font-bold text-emerald-500/10 dark:text-emerald-400/10">$10</div>
        <div className="text-lg text-emerald-500/10 dark:text-emerald-400/10 -mt-1 text-right">bonus</div>
      </div>
    )
  }
];

const Card = ({ data, index, onDismiss }: { data: CTAData; index: number; onDismiss: () => void }) => {
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-200, 0, 200], [0, 1, 0]);
  const rotate = useTransform(x, [-200, 200], [-5, 5]);

  const isFront = index === 0;

  const handleDragEnd = (_: any, info: any) => {
    if (Math.abs(info.offset.x) > 100) {
      onDismiss();
    }
  };

  return (
    <motion.div
      style={{ 
        zIndex: 15 - index,
        x: isFront ? x : 0,
        opacity: isFront ? opacity : 1 - (index * 0.15),
        scale: 1 - (index * 0.05),
        y: index * 8 - (index * 2), // Small offset like playing cards
        rotate: isFront ? rotate : (index % 2 === 0 ? index : -index), // Slight rotation for stack effect
      }}
      drag={isFront ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.9, opacity: 0, y: 20 }}
      animate={{ 
        scale: 1 - (index * 0.05), 
        opacity: 1 - (index * 0.15), 
        y: index * 8 - (index * 2),
        rotate: isFront ? 0 : (index % 2 === 0 ? index : -index)
      }}
      exit={{ opacity: 0, x: x.get() < 0 ? -200 : 200, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={`absolute inset-0 bg-gradient-to-br ${data.gradient} rounded-lg p-6 overflow-hidden border border-zinc-200 dark:border-zinc-800/50 shadow-sm ${isFront ? 'cursor-grab active:cursor-grabbing' : ''} origin-bottom`}
    >
      {/* Content */}
      <div className="relative z-10 h-full flex flex-col justify-between">
         <div className="space-y-2">
            <h3 className="text-black dark:text-white font-semibold text-lg max-w-[85%]">{data.title}</h3>
            <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed max-w-[85%]">
                {data.description}
            </p>
         </div>
         <button className="bg-zinc-900 dark:bg-zinc-800 text-white px-5 py-2.5 rounded-full text-sm font-normal hover:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors w-fit shadow-sm">
            {data.buttonText}
         </button>
      </div>
      
      {/* Graphic rendered below content but above background */}
      {data.renderGraphic()}
    </motion.div>
  );
};

export default function CTAStack() {
  const [cards, setCards] = useState(initialCards);
  const [isDone, setIsDone] = useState(false);

  const handleDismiss = (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  };

  const handleDismissAll = () => {
    setIsDone(true);
  };

  if (isDone) return null;

  return (
    <div className="relative w-full h-[240px]">
      <AnimatePresence>
        {cards.length > 0 ? (
          cards.map((card, index) => (
            <Card 
              key={card.id} 
              data={card} 
              index={index} 
              onDismiss={() => handleDismiss(card.id)} 
            />
          ))
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute inset-0 bg-white dark:bg-[#0e0e0e] rounded-lg p-6 flex flex-col items-center justify-center text-center border border-dashed border-zinc-300 dark:border-zinc-800"
          >
            <div className="w-16 h-16 bg-zinc-50 dark:bg-zinc-900 rounded-full flex items-center justify-center mb-4 ring-1 ring-zinc-100 dark:ring-zinc-800">
              <Check className="w-6 h-6 text-zinc-400 dark:text-zinc-500" strokeWidth={2.5} />
            </div>
            <h3 className="text-zinc-900 dark:text-white font-medium mb-1">All caught up</h3>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-5 font-light">
              You've viewed all available offers for now.
            </p>
            <button 
              onClick={handleDismissAll}
              className="px-4 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 text-xs font-normal text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all uppercase tracking-wider"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Counter Badge */}
      {cards.length > 0 && (
        <div className="absolute -top-3 -right-3 z-20 w-9 h-9 bg-blue-600 dark:bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-medium shadow-lg border-2 border-white animate-in zoom-in duration-300">
          {cards.length}
        </div>
      )}
    </div>
  );
}

