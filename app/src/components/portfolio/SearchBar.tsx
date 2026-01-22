import { Search, SlidersHorizontal } from 'lucide-react';

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedCategories: string[];
  onCategoryToggle: (category: string) => void;
  filterCategories: string[];
  onFilterClick?: () => void;
  placeholder?: string;
  showCategories?: boolean;
}

export default function SearchBar({
  searchQuery,
  onSearchChange,
  selectedCategories,
  onCategoryToggle,
  filterCategories,
  onFilterClick,
  placeholder = 'Search assets, symbols, news...',
  showCategories = true,
}: SearchBarProps) {
  return (
    <div className="w-full">
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input 
            type="text" 
            placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-zinc-100 dark:bg-zinc-900 border-none rounded py-3 pl-10 pr-4 text-sm focus:ring-1 focus:ring-black dark:focus:ring-white transition-all"
            autoFocus
          />
        </div>
        {onFilterClick && (
          <button 
            onClick={onFilterClick}
            className="bg-zinc-100 dark:bg-zinc-900 p-3 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          >
            <SlidersHorizontal className="w-5 h-5 text-black dark:text-white" />
          </button>
        )}
      </div>
      
      {/* Category/Filter Tags */}
      {showCategories && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {filterCategories.map(category => {
            const isSelected = selectedCategories.includes(category);
            return (
              <button
                key={category}
                onClick={() => onCategoryToggle(category)}
                className={`px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-black dark:bg-white text-white dark:text-black' 
                    : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                }`}
              >
                {category}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
