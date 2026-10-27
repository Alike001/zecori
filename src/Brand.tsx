import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export type BrandContext = 'Shielded routes' | 'Documentation' | 'Verified receipt';

export function ZecoriMark({ title = 'Zecori private-origin route mark' }: { title?: string }) {
  return <svg className="zecori-mark" viewBox="0 0 48 48" role="img" aria-label={title}>
    <path className="zecori-mark-origin" d="M8 24a10 10 0 1 1 20 0 10 10 0 0 1-20 0Z"/>
    <path className="zecori-mark-veil" d="M18 14v20"/>
    <path className="zecori-mark-route" d="M18 24h8c7.2 0 7.2-9 14-9M18 24h8c7.2 0 7.2 9 14 9"/>
    <path className="zecori-mark-destination" d="M40 11v8M36 15h8M40 29v8M36 33h8"/>
  </svg>;
}

export function BrandWordmark({ context = 'Shielded routes' }: { context?: BrandContext }) {
  return <span className="brand-lockup"><ZecoriMark/><span><span className="brand-name">Zecori</span><small>{context}</small></span></span>;
}

type Theme = 'dark' | 'light';

function preferredTheme(): Theme {
  const saved = window.localStorage.getItem('zecori-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => preferredTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('zecori-theme', theme);
  }, [theme]);
  const next = theme === 'dark' ? 'light' : 'dark';
  return <button className="theme-toggle" type="button" onClick={() => setTheme(next)} aria-label={`Use ${next} theme`} title={`Use ${next} theme`}>
    {theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}<span className="sr-only">Use {next} theme</span>
  </button>;
}
