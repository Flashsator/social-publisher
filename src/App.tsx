import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import Setup from "./pages/Setup";
import Compose from "./pages/Compose";

const navItem =
  "px-4 py-2 rounded-md text-sm font-medium transition-colors hover:bg-(--color-surface-2)";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-(--color-border) bg-(--color-surface)">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-6">
          <div className="font-semibold tracking-tight">Social Publisher</div>
          <nav className="flex items-center gap-1">
            <NavLink
              to="/compose"
              className={({ isActive }) =>
                `${navItem} ${isActive ? "bg-(--color-surface-2) text-(--color-accent)" : "text-(--color-muted)"}`
              }
            >
              Compose
            </NavLink>
            <NavLink
              to="/setup"
              className={({ isActive }) =>
                `${navItem} ${isActive ? "bg-(--color-surface-2) text-(--color-accent)" : "text-(--color-muted)"}`
              }
            >
              Setup
            </NavLink>
          </nav>
          <div className="ml-auto text-xs text-(--color-muted)">
            Credentials stay on this device
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/compose" replace />} />
          <Route path="/compose" element={<Compose />} />
          <Route path="/setup" element={<Setup />} />
        </Routes>
      </main>
    </div>
  );
}
