import { useTheme } from '@/context/ThemeContext';
import { SunIcon, DuskIcon, MoonIcon } from '@/components/app-ui/ThemeIcons';
import { Btn } from '@/components/clear/brand/anatomy';
import { cn } from '@/lib/utils';

const THEMES = [
  { id: 'light', label: 'Light', Icon: SunIcon },
  { id: 'dusk', label: 'Dusk', Icon: DuskIcon },
  { id: 'dark', label: 'Dark', Icon: MoonIcon },
] as const;

/**
 * Appearance — a three-way chooser, not a toggle.
 *
 * The app has three grounds, and dusk is not a midpoint between the other two: a two-state switch
 * would make it unreachable. The guide's split chooser, the same one the plan lengths use, wired to
 * the real theme context so it changes the app rather than describing that it could.
 */
export default function ThemePicker({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={cn('c-qc c-split', className)}>
      {THEMES.map(({ id, label, Icon }) => (
        <Btn
          key={id}
          className={cn('c-chip-q', theme === id && 'c-on')}
          aria-pressed={theme === id}
          onClick={() => setTheme(id)}
        >
          <Icon className="h-[15px] w-[15px] shrink-0" />
          {label}
        </Btn>
      ))}
    </div>
  );
}
