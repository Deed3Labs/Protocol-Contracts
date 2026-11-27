import { useState, useEffect } from 'react';
import type { DeedNFT } from '@/context/DeedNFTContext';

interface TokenMetadata {
  name?: string;
  description?: string;
  image?: string;
  images?: string[];
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
}

/**
 * Hook to fetch and return the deed name from metadata
 * @param deedNFT - The DeedNFT object with URI
 * @returns The deed name from metadata, or null if not available
 */
export const useDeedName = (deedNFT: DeedNFT | null): string | null => {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const fetchName = async () => {
      if (!deedNFT?.uri) {
        setName(null);
        return;
      }

      try {
        const response = await fetch(deedNFT.uri);
        if (!response.ok) {
          setName(null);
          return;
        }
        
        const data: TokenMetadata = await response.json();
        setName(data.name || null);
      } catch (error) {
        console.error('Error fetching deed name:', error);
        setName(null);
      }
    };

    fetchName();
  }, [deedNFT?.uri, deedNFT?.tokenId]);

  return name;
};

