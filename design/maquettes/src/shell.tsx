import {
  IconActivity,
  IconBarChart2,
  IconChevronLeft,
  IconClock,
  IconCreditCard,
  IconDatabase,
  IconDownload,
  IconList,
  IconRadio,
  IconUpload,
  IconUser,
  IconUsers,
} from "icons";
import {
  IconButton,
  Navigation,
  NavigationButton,
  Text,
  TextHeading,
  TextSmall,
  TextStrong,
} from "primitives";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ client */

export type ClientTab = "portefeuille" | "marche" | "historique" | "compte";

export function ClientShell({
  title,
  subtitle,
  back,
  active,
  action,
  children,
}: {
  title?: string;
  subtitle?: string;
  back?: string;
  active?: ClientTab;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="phone">
      <div className="phone-top">
        {back ? (
          <IconButton variant="subtle" aria-label="Retour" href={back}>
            <IconChevronLeft size="24" />
          </IconButton>
        ) : (
          <TextHeading>XAFe</TextHeading>
        )}
        <div className="phone-top-title">
          {title && <TextStrong>{title}</TextStrong>}
          {subtitle && <TextSmall className="t-sec">{subtitle}</TextSmall>}
        </div>
        {action}
      </div>
      <div className="phone-body">{children}</div>
      {active && (
        <nav className="phone-nav" aria-label="Navigation">
          <Navigation direction="row" className="phone-nav-items">
            <NavigationButton
              href="/client/portefeuille"
              isSelected={active === "portefeuille"}
              icon={<IconCreditCard size="20" />}
            >
              Portefeuille
            </NavigationButton>
            <NavigationButton
              href="/client/marche"
              isSelected={active === "marche"}
              icon={<IconBarChart2 size="20" />}
            >
              Marché
            </NavigationButton>
            <NavigationButton
              href="/client/historique"
              isSelected={active === "historique"}
              icon={<IconClock size="20" />}
            >
              Historique
            </NavigationButton>
            <NavigationButton
              href="/client/compte"
              isSelected={active === "compte"}
              icon={<IconUser size="20" />}
            >
              Compte
            </NavigationButton>
          </Navigation>
        </nav>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- admin */

export type AdminTab =
  | "reserves"
  | "entrees"
  | "sorties"
  | "terminaux"
  | "marche"
  | "clients";

export function AdminShell({
  active,
  title,
  subtitle,
  actions,
  children,
}: {
  active: AdminTab;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const items: { id: AdminTab; label: string; icon: ReactNode; href: string }[] =
    [
      { id: "reserves", label: "Réserves", icon: <IconDatabase size="20" />, href: "/admin/reserves" },
      { id: "entrees", label: "Entrées", icon: <IconDownload size="20" />, href: "/admin/entrees" },
      { id: "sorties", label: "Sorties", icon: <IconUpload size="20" />, href: "/admin/sorties" },
      { id: "terminaux", label: "Terminaux TOTEM", icon: <IconRadio size="20" />, href: "/admin/terminaux" },
      { id: "marche", label: "Marché", icon: <IconActivity size="20" />, href: "/admin/marche" },
      { id: "clients", label: "Clients", icon: <IconUsers size="20" />, href: "/admin/clients" },
    ];
  return (
    <div className="admin">
      <aside className="admin-side">
        <div className="col">
          <TextHeading>XAFe</TextHeading>
          <TextSmall className="t-sec">Administration</TextSmall>
        </div>
        <Navigation direction="column">
          {items.map((it) => (
            <NavigationButton
              key={it.id}
              href={it.href}
              direction="row"
              isSelected={active === it.id}
              icon={it.icon}
            >
              {it.label}
            </NavigationButton>
          ))}
        </Navigation>
        <div className="grow" />
        <div className="col">
          <TextStrong>Nelson S.</TextStrong>
          <TextSmall className="t-sec">super admin · Douala</TextSmall>
        </div>
      </aside>
      <main className="admin-main">
        <div className="row">
          <div className="col">
            <TextHeading>{title}</TextHeading>
            {subtitle && <Text className="t-sec">{subtitle}</Text>}
          </div>
          <div className="row-start">{actions}</div>
        </div>
        {children}
      </main>
    </div>
  );
}

/* --------------------------------------------------------------- partagés */

export function Line({
  label,
  value,
  strong,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className="row">
      <Text className="t-sec">{label}</Text>
      {strong ? (
        <TextStrong className={`num ${className ?? ""}`}>{value}</TextStrong>
      ) : (
        <Text className={`num ${className ?? ""}`}>{value}</Text>
      )}
    </div>
  );
}

export function ListIcon() {
  return <IconList size="20" />;
}
