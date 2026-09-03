import { useTheme } from '@/context/ThemeContext';
import { SunIcon, DuskIcon, MoonIcon } from '@/components/app-ui/ThemeIcons';
import { cn } from '@/lib/utils';

const THEMES = [
  { id: 'light', label: 'Light', Icon: SunIcon },
  { id: 'dusk', label: 'Dusk', Icon: DuskIcon },
  { id: 'dark', label: 'Dark', Icon: MoonIcon },
] as const;

/**
 * Appearance — a three-way segmented control, not a toggle.
 *
 * The app has three themes, and dusk isn't a midpoint between the other two; a
 * two-state switch would make it unreachable. Wired to the real theme context,
 * so this actually changes the app rather than describing that it could.
 */
export default function ThemePicker({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={cn('flex gap-1 rounded-lg bg-secondary p-[3px]', className)}>
      {THEMES.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={theme === id}
          onClick={() => setTheme(id)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-colors',
            theme === id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-foreground-secondary hover:text-foreground',
          )}
        >
          <Icon className="h-[15px] w-[15px] shrink-0" />
          {label}
        </button>
      ))}
    </div>
  );
}
