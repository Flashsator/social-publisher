import { useEffect } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import Setup from "./pages/Setup";
import Compose from "./pages/Compose";
import Schedule from "./pages/Schedule";
import Help from "./pages/Help";
import { useT } from "./lib/i18n";

const navItem =
  "px-4 py-2 rounded-md text-sm font-medium transition-colors hover:bg-(--color-surface-2)";

export default function App() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.pathname === "/") navigate("/compose", { replace: true });
  }, [location.pathname, navigate]);
  const onSetup = location.pathname.startsWith("/setup");
  const onSchedule = location.pathname.startsWith("/schedule");
  const onHelp = location.pathname.startsWith("/help");
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-(--color-border) bg-(--color-surface)">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-6">
          <div className="font-semibold tracking-tight">{t("appTitle")}</div>
          <nav className="flex items-center gap-1">
            <NavLink
              to="/compose"
              className={({ isActive }) =>
                `${navItem} ${isActive ? "bg-(--color-surface-2) text-(--color-accent)" : "text-(--color-muted)"}`
              }
            >
              {t("navCompose")}
            </NavLink>
            <NavLink
              to="/schedule"
              className={({ isActive }) =>
                `${navItem} ${isActive ? "bg-(--color-surface-2) text-(--color-accent)" : "text-(--color-muted)"}`
              }
            >
              {t("navSchedule")}
            </NavLink>
            <NavLink
              to="/setup"
              className={({ isActive }) =>
                `${navItem} ${isActive ? "bg-(--color-surface-2) text-(--color-accent)" : "text-(--color-muted)"}`
              }
            >
              {t("navSetup")}
            </NavLink>
            <NavLink
              to="/help"
              className={({ isActive }) =>
                `${navItem} ${isActive ? "bg-(--color-surface-2) text-(--color-accent)" : "text-(--color-muted)"}`
              }
            >
              {t("navHelp")}
            </NavLink>
          </nav>
          <div className="ml-auto text-xs text-(--color-muted)">
            {t("credentialsHint")}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <div
          style={{
            display: onSetup || onSchedule || onHelp ? "none" : "block",
          }}
        >
          <Compose />
        </div>
        {onSetup && <Setup />}
        {onSchedule && <Schedule />}
        {onHelp && <Help />}
      </main>
    </div>
  );
}
