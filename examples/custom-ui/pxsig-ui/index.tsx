/**
 * A deliberately plain UI adapter: the dashboard on semantic HTML and one small stylesheet, as a
 * starting point for an adapter on a real design system. It supplies the required components and a
 * few optional ones; everything else renders the dashboard's own fallbacks, and
 * `pxsig dashboard gaps` lists them.
 */
import React from 'react';
import type * as C from 'pxsig/dashboard';
import './theme.css';

export const name = 'plain';

/** Every neutral token, mapped to this adapter's custom properties or to literal values. */
export const tokens: C.TokenMap = {
  'color.background': 'var(--plain-bg)',
  'color.surface': 'var(--plain-surface)',
  'color.surfaceRaised': 'var(--plain-raised)',
  'color.border': 'var(--plain-border)',
  'color.text': 'var(--plain-text)',
  'color.textMuted': 'var(--plain-muted)',
  'color.accent': 'var(--plain-accent)',
  'color.focus': 'var(--plain-accent)',
  'color.hover': 'var(--plain-hover)',
  'color.success': 'var(--plain-success)',
  'color.warning': 'var(--plain-warning)',
  'color.danger': 'var(--plain-danger)',
  'space.0_5': '0.125rem',
  'space.1': '0.25rem',
  'space.1_5': '0.375rem',
  'space.2': '0.5rem',
  'space.2_5': '0.625rem',
  'space.3': '0.75rem',
  'space.4': '1rem',
  'space.5': '1.25rem',
  'space.6': '1.5rem',
  'space.8': '2rem',
  'space.12': '3rem',
  'radius.sm': '0.125rem',
  'radius.md': '0.25rem',
  'radius.lg': '0.5rem',
  'font.sans': 'system-ui, sans-serif',
  'font.mono': 'ui-monospace, monospace',
  'fontSize.3xs': '0.5625rem',
  'fontSize.2xs': '0.6875rem',
  'fontSize.xs': '0.75rem',
  'fontSize.sm': '0.875rem',
  'fontSize.lg': '1.125rem',
  'fontWeight.semibold': '600',
  'lineHeight.relaxed': '1.6',
  'letterSpacing.caps': '0.06em',
  'line.emphasis': '2px',
  'motion.fast': '120ms',
};

/** Theme mode as an attribute the stylesheet reads. */
export function UiProvider({ mode, children }: C.UiProviderProps) {
  React.useEffect(() => document.documentElement.setAttribute('data-theme', mode), [mode]);
  return <>{children}</>;
}

/** No overflow menu: links wrap onto a second row on a narrow window (conformance: partial). */
export const TopNav = ({ label, brand, className, children }: C.TopNavProps) => (
  <nav aria-label={label} className={['plain-nav', className].filter(Boolean).join(' ')}>
    {brand}
    {children}
  </nav>
);
export const NavList = ({ children }: C.NavListProps) => (
  <ul>{React.Children.map(children, (c) => (c ? <li>{c}</li> : null))}</ul>
);
/** A link's text for its accessible name: the dashboard passes the label as text. */
const textOf = (node: React.ReactNode): string =>
  React.Children.toArray(node)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
    .join('');
export const NavLink = ({ href, active, count, countLabel, children }: C.NavLinkProps) => (
  <a
    href={href}
    aria-current={active ? 'page' : undefined}
    aria-label={count ? `${textOf(children)}, ${countLabel ?? count}` : undefined}
  >
    {children}
    {count ? <span className="plain-badge"> {count > 99 ? '99+' : count}</span> : null}
  </a>
);

export function Button({
  emphasis = 'solid',
  size,
  href,
  external,
  children,
  ...rest
}: C.ButtonProps) {
  if (href)
    return (
      <a
        className="plain-button"
        data-emphasis={emphasis}
        data-size={size}
        href={href}
        title={rest.title}
        aria-label={rest['aria-label']}
        {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      >
        {children}
      </a>
    );
  return (
    <button
      type="button"
      className="plain-button"
      data-emphasis={emphasis}
      data-size={size}
      {...rest}
    >
      {children}
    </button>
  );
}
export const IconButton = ({
  label,
  title,
  emphasis = 'outline',
  size,
  disabled,
  onClick,
  children,
}: C.IconButtonProps) => (
  <button
    type="button"
    className="plain-button"
    data-emphasis={emphasis}
    data-size={size}
    aria-label={label}
    title={title}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
);

export const Card = ({ children }: C.CardProps) => (
  <section className="plain-card">{children}</section>
);
export const CardHeader = ({ children }: C.CardHeaderProps) => <header>{children}</header>;
export const CardTitle = ({ children }: C.CardTitleProps) => <h3>{children}</h3>;
export const CardDescription = ({ className, children }: C.CardDescriptionProps) => (
  <p className={className}>{children}</p>
);
export const CardContent = ({ children }: C.CardContentProps) => <div>{children}</div>;

const GLYPH: Record<C.IconName, string> = {
  check: '✓',
  alert: '⚠',
  dot: '●',
  ban: '⊘',
  pause: '‖',
  dashed: '◌',
  cross: '✕',
  sun: '☀',
  moon: '☾',
  'arrow-down-left': '↙',
  'arrow-up-right': '↗',
  external: '↗',
};
export const Icon = ({ name, size, className }: C.IconProps) => (
  <span aria-hidden="true" className={className} style={size ? { fontSize: size } : undefined}>
    {GLYPH[name]}
  </span>
);
export const StatusBadge = ({ tone, icon, label, title, className }: C.StatusBadgeProps) => (
  <span
    className={['plain-status', className].filter(Boolean).join(' ')}
    data-tone={tone}
    title={title}
  >
    <Icon name={icon} />
    <span>{label}</span>
  </span>
);
export const Badge = ({
  tone = 'neutral',
  emphasis = 'subtle',
  title,
  className,
  children,
}: C.BadgeProps) => (
  <span
    className={['plain-badge', className].filter(Boolean).join(' ')}
    data-tone={tone}
    data-emphasis={emphasis}
    title={title}
  >
    {children}
  </span>
);

/** A native modal dialog: Esc closes it through onOpenChange(false). */
export function Dialog({ open, onOpenChange, initialFocus, className, children }: C.DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      if (initialFocus?.current) initialFocus.current.focus({ preventScroll: true });
    }
    if (!open && d.open) d.close();
  }, [open, initialFocus]);
  const titleId = React.useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={['plain-dialog', className].filter(Boolean).join(' ')}
      onCancel={(e) => (e.preventDefault(), onOpenChange(false))}
    >
      <DialogTitleId.Provider value={titleId}>{children}</DialogTitleId.Provider>
    </dialog>
  );
}
const DialogTitleId = React.createContext<string | undefined>(undefined);
export function DialogTitle({ ref, tabIndex, className, children }: C.DialogTitleProps) {
  const id = React.useContext(DialogTitleId);
  return (
    <h2 ref={ref} id={id} tabIndex={tabIndex} className={className}>
      {children}
    </h2>
  );
}
export const DialogDescription = ({ className, style, children }: C.DialogDescriptionProps) => (
  <p className={className} style={style}>
    {children}
  </p>
);

export const Select = ({ value, onValueChange, options, label, inlineSize }: C.SelectProps) => (
  <select
    className="plain-select"
    value={value}
    aria-label={label}
    style={inlineSize ? { inlineSize } : undefined}
    onChange={(e) => onValueChange(e.target.value)}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

export const Kbd = ({ children }: C.KbdProps) => <kbd>{children}</kbd>;
