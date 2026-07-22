// Persistent app navigation — the shell every property-management platform
// (DoorLoop, Buildium, AppFolio) is built around. Items map to Fulcrum's
// actual roadmap phases; future phases render disabled with a "soon" tag.
import type { ReactNode } from "react";
import { LogoutButton } from "./logout-button";

function Icon({ path }: { path: ReactNode }) {
  return (
    <svg
      className="nav-ico"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

type NavKey = "dashboard" | "sellers" | "leads" | "matches" | "outcomes";

const NAV: { key: NavKey; label: string; href?: string; soon?: boolean; icon: ReactNode }[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    soon: true,
    icon: <><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>,
  },
  {
    key: "sellers",
    label: "Sellers",
    href: "/",
    icon: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" /></>,
  },
  {
    key: "leads",
    label: "Buyer Leads",
    href: "/leads",
    icon: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>,
  },
  {
    key: "matches",
    label: "Matches",
    href: "/matches",
    icon: <><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /><circle cx="12" cy="12" r="3" /></>,
  },
  {
    key: "outcomes",
    label: "Outcomes",
    href: "/outcomes",
    icon: <><path d="M3 3v18h18" /><path d="m7 14 3-4 3 3 4-6" /></>,
  },
];

export function Sidebar({ active, agentName }: { active: NavKey; agentName?: string }) {
  return (
    <aside className="sidebar">
      <div className="side-brand">
        <span className="side-mark">
          Fulcrum<span className="brand-dot">.</span>
        </span>
      </div>

      <nav className="nav">
        {NAV.map((item) => {
          const isActive = item.key === active;
          const cls = `nav-item${isActive ? " active" : ""}${item.soon ? " soon" : ""}`;
          const inner = (
            <>
              <Icon path={item.icon} />
              <span className="nav-label">{item.label}</span>
              {item.soon && <span className="nav-soon">soon</span>}
            </>
          );
          return item.href ? (
            <a key={item.key} href={item.href} className={cls} aria-current={isActive ? "page" : undefined}>
              {inner}
            </a>
          ) : (
            <span key={item.key} className={cls}>
              {inner}
            </span>
          );
        })}
      </nav>

      <div className="nav-foot">
        {agentName && <div className="nav-agent">{agentName}</div>}
        <LogoutButton />
      </div>
    </aside>
  );
}
