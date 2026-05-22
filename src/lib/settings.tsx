import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "zh" | "en";
export type Theme = "dark" | "light";

type Settings = {
  lang: Lang;
  theme: Theme;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
};

const LANG_KEY = "sp.lang";
const THEME_KEY = "sp.theme";

const SettingsCtx = createContext<Settings | null>(null);

function readLang(): Lang {
  const v = localStorage.getItem(LANG_KEY);
  return v === "en" || v === "zh" ? v : "zh";
}

function readTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" ? v : "dark";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang === "zh" ? "zh-TW" : "en");
  }, [lang]);

  const value = useMemo<Settings>(
    () => ({
      lang,
      theme,
      setLang: (l) => {
        localStorage.setItem(LANG_KEY, l);
        setLangState(l);
      },
      setTheme: (t) => {
        localStorage.setItem(THEME_KEY, t);
        setThemeState(t);
      },
    }),
    [lang, theme]
  );

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): Settings {
  const v = useContext(SettingsCtx);
  if (!v) throw new Error("useSettings must be used inside SettingsProvider");
  return v;
}
