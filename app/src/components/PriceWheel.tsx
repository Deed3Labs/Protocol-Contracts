import React, { useEffect, useRef, useState } from 'react';

interface PriceWheelProps {
  value: number;
  previousValue?: number;
  formatter?: (value: number) => string;
  className?: string;
  duration?: number;
}

/**
 * PriceWheel component - Smoothly animates number changes with a rolling effect
 * Similar to stock ticker displays
 */
export const PriceWheel: React.FC<PriceWheelProps> = ({
  value,
  previousValue,
  formatter = (v) => v.toFixed(2),
  className = '',
  duration = 500,
}) => {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const startValueRef = useRef<number>(value);
  const targetValueRef = useRef<number>(value);

  useEffect(() => {
    // If value hasn't changed, don't animate
    if (value === targetValueRef.current) {
      return;
    }

    // If this is the first render or previousValue is undefined, just set the value
    if (previousValue === undefined || previousValue === value) {
      setDisplayValue(value);
      targetValueRef.current = value;
      startValueRef.current = value;
      return;
    }

    // Start animation
    startValueRef.current = previousValue;
    targetValueRef.current = value;
    setIsAnimating(true);
    startTimeRef.current = null;

    const animate = (currentTime: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function (ease-out)
      const easeOut = 1 - Math.pow(1 - progress, 3);

      // Interpolate value
      const currentValue = startValueRef.current + (targetValueRef.current - startValueRef.current) * easeOut;
      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        // Animation complete
        setDisplayValue(targetValueRef.current);
        setIsAnimating(false);
        startValueRef.current = targetValueRef.current;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, previousValue, duration]);

  // Determine color based on change direction
  const getColorClass = () => {
    if (!previousValue || previousValue === value || isAnimating) {
      return '';
    }
    if (value > previousValue) {
      return 'text-green-500';
    } else if (value < previousValue) {
      return 'text-red-500';
    }
    return '';
  };

  return (
    <span className={`transition-colors duration-300 ${getColorClass()} ${className}`}>
      {formatter(displayValue)}
    </span>
  );
};

/**
 * Compact price wheel for smaller displays
 */
export const CompactPriceWheel: React.FC<PriceWheelProps> = (props) => {
  return <PriceWheel {...props} formatter={(v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />;
};

/**
 * Large price wheel for main balance display
 */
export const LargePriceWheel: React.FC<PriceWheelProps> = (props) => {
  return (
    <PriceWheel
      {...props}
      formatter={(v) => {
        if (v >= 1000000) {
          return `$${(v / 1000000).toFixed(2)}M`;
        } else if (v >= 1000) {
          return `$${(v / 1000).toFixed(2)}K`;
        }
        return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }}
      className="text-3xl font-bold"
      duration={600}
    />
  );
};
