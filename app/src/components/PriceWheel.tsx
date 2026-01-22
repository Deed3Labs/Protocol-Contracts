import React, { useEffect, useRef, useState } from 'react';

interface PriceWheelProps {
  value: number;
  previousValue?: number;
  formatter?: (value: number) => string;
  className?: string;
  duration?: number;
  colorResetDelay?: number; // Delay in ms before resetting color to default (default: 2000ms)
}

/**
 * PriceWheel component - Smoothly animates number changes with a rolling effect
 * Similar to stock ticker displays
 * Color changes (red/green) automatically reset to default after a few seconds
 */
export const PriceWheel: React.FC<PriceWheelProps> = ({
  value,
  previousValue,
  formatter = (v) => v.toFixed(2),
  className = '',
  duration = 500,
  colorResetDelay = 2000, // Default 2 seconds
}) => {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showColorChange, setShowColorChange] = useState(false);
  const [colorDirection, setColorDirection] = useState<'up' | 'down' | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const startValueRef = useRef<number>(value);
  const targetValueRef = useRef<number>(value);
  const isInitialMountRef = useRef<boolean>(true);
  const colorResetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // On initial mount, set the value immediately
    if (isInitialMountRef.current) {
      setDisplayValue(value);
      targetValueRef.current = value;
      startValueRef.current = value;
      isInitialMountRef.current = false;
      return;
    }

    // If value hasn't changed, don't animate
    if (value === targetValueRef.current) {
      return;
    }

    // If previousValue is undefined, just set the value immediately
    if (previousValue === undefined) {
      setDisplayValue(value);
      targetValueRef.current = value;
      startValueRef.current = value;
      return;
    }

    // If previousValue equals current value, no animation needed
    if (previousValue === value) {
      setDisplayValue(value);
      targetValueRef.current = value;
      startValueRef.current = value;
      return;
    }

    // Determine color change direction
    const direction = value > previousValue ? 'up' : 'down';
    setColorDirection(direction);
    setShowColorChange(true);

    // Clear any existing color reset timeout
    if (colorResetTimeoutRef.current) {
      clearTimeout(colorResetTimeoutRef.current);
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

        // Set timeout to reset color after animation completes
        colorResetTimeoutRef.current = setTimeout(() => {
          setShowColorChange(false);
          setColorDirection(null);
        }, colorResetDelay);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      if (colorResetTimeoutRef.current) {
        clearTimeout(colorResetTimeoutRef.current);
      }
    };
  }, [value, previousValue, duration, colorResetDelay]);

  // Determine color based on change direction (only show when showColorChange is true)
  const getColorClass = () => {
    if (!showColorChange || isAnimating) {
      return '';
    }
    if (colorDirection === 'up') {
      return 'text-green-500';
    } else if (colorDirection === 'down') {
      return 'text-red-500';
    }
    return '';
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (colorResetTimeoutRef.current) {
        clearTimeout(colorResetTimeoutRef.current);
      }
    };
  }, []);

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
      className={props.className || ""}
      duration={600}
    />
  );
};
