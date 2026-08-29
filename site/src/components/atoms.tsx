"use client";

import * as React from "react";
import { motion, type MotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/icons";

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

export type ButtonVariant = "primary" | "secondary" | "ghost" | "warning" | "danger" | "outline" | "solid";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  size?: "sm" | "md";
}

export function Button({
  variant = "primary",
  icon,
  size = "md",
  className,
  children,
  ...rest
}: ButtonProps) {
  const variantClasses: Record<ButtonVariant, string> = {
    primary:
      "border border-accent text-accent bg-transparent hover:bg-accent hover:text-void",
    solid:
      "border border-accent bg-accent text-void hover:bg-accent/90",
    secondary:
      "border border-border-light text-text-muted bg-transparent hover:border-text-muted hover:text-text-primary",
    ghost:
      "border border-border-light text-text-muted bg-transparent hover:text-text-primary hover:border-text-muted",
    warning:
      "border border-yellow-500/40 text-yellow-300 bg-yellow-500/10 hover:border-red-400/60 hover:bg-red-500/10 hover:text-red-300",
    danger:
      "border border-yellow-500/40 text-yellow-300 bg-yellow-500/10 hover:border-red-400/60 hover:bg-red-500/10 hover:text-red-300",
    outline:
      "border border-border-light text-text-primary bg-transparent hover:border-accent",
  };
  const { onClick, type, disabled, "aria-label": aria, title } = rest;
  return (
    <motion.button
      onClick={onClick}
      type={type}
      disabled={disabled}
      aria-label={aria}
      title={title}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.1 }}
      className={cn(
        "uppercase tracking-wider transition-colors duration-150 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "px-2 h-7 text-[10px]" : "px-3 h-8 text-xs",
        variantClasses[variant],
        className,
      )}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 11 : 12} /> : null}
      {children}
    </motion.button>
  );
}

export function Chip({
  children,
  tone = "muted",
  className,
  icon,
  iconSize = 10,
}: {
  children: React.ReactNode;
  tone?: "muted" | "accent" | "warn" | "danger" | "purple" | "cyan" | "yellow" | "pink" | "orange" | "blue" | "red";
  className?: string;
  icon?: IconName;
  iconSize?: number;
}) {
  const toneClasses: Record<string, string> = {
    muted: "bg-border text-text-muted",
    accent: "bg-accent/10 text-accent border border-accent/30",
    warn: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30",
    danger: "bg-red-500/10 text-red-400 border border-red-500/30",
    purple: "bg-purple-500/10 text-purple-400 border border-purple-500/30",
    cyan: "bg-cyan-400/10 text-cyan-400 border border-cyan-400/30",
    yellow: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30",
    pink: "bg-pink-400/10 text-pink-400 border border-pink-400/30",
    orange: "bg-orange-400/10 text-orange-400 border border-orange-400/30",
    blue: "bg-blue-400/10 text-blue-400 border border-blue-400/30",
    red: "bg-red-500/10 text-red-400 border border-red-500/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
        toneClasses[tone],
        className,
      )}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
  hintTone = "accent",
  className,
  delay = 0,
  onClick,
  active = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  hintTone?: "accent" | "muted" | "warn" | "danger";
  className?: string;
  delay?: number;
  onClick?: () => void;
  active?: boolean;
}) {
  const hintToneCls = {
    accent: "text-accent",
    muted: "text-text-muted",
    warn: "text-yellow-400",
    danger: "text-red-400",
  }[hintTone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: EASE }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? active : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "bg-surface border border-border p-3 group transition-colors duration-150",
        onClick ? "cursor-pointer hover:border-accent/50" : "hover:border-accent/30",
        active && "outline outline-2 outline-accent -outline-offset-2",
        className,
      )}
    >
      <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
        &gt; {label}
      </div>
      <motion.div
        className="font-pixel text-3xl text-text-primary tracking-wider"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: delay + 0.1, duration: 0.2 }}
      >
        {value}
      </motion.div>
      {hint ? (
        <div className={cn("text-[10px] mt-1 flex items-center gap-1", hintToneCls)}>
          {hint}
        </div>
      ) : null}
    </motion.div>
  );
}

export function ToggleButton({
  active,
  children,
  onClick,
  className,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 h-7 text-[10px] uppercase tracking-wider transition-colors border",
        active
          ? "bg-accent text-void border-accent"
          : "bg-transparent text-text-muted border-border hover:text-text-primary hover:border-border-light",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Tabs<T extends string>({
  items,
  current,
  onChange,
  className,
  layoutId = "tab-pill",
}: {
  items: { key: T; label: string; icon?: IconName }[];
  current: T;
  onChange: (key: T) => void;
  className?: string;
  layoutId?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1 border-b border-border pb-px", className)}>
      {items.map((item) => {
        const active = item.key === current;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className={cn(
              "relative flex items-center gap-1.5 px-4 py-2 text-[11px] uppercase tracking-wider transition-colors",
              active ? "text-accent" : "text-text-muted hover:text-text-primary",
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-x-0 -bottom-px h-px bg-accent"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            ) : null}
            {item.icon ? <Icon name={item.icon} size={12} /> : null}
            <span className="relative">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PillTabs<T extends string>({
  items,
  current,
  onChange,
  className,
  layoutId = "pill-tab",
}: {
  items: { key: T; label: string; icon?: IconName; disabled?: boolean; title?: string }[];
  current: T;
  onChange: (key: T) => void;
  className?: string;
  layoutId?: string;
}) {
  return (
    <div className={cn("inline-flex gap-1 bg-void border border-border p-1", className)}>
      {items.map((item) => {
        const active = item.key === current;
        return (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            title={item.title}
            onClick={() => onChange(item.key)}
            className={cn(
              "relative flex items-center gap-2 px-3 py-1.5 transition-colors text-[10px] uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed",
              active ? "text-void" : "text-text-muted hover:text-text-primary",
            )}
          >
            {active ? (
              <motion.span layoutId={layoutId} className="absolute inset-0 bg-accent" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
            ) : null}
            {item.icon ? <Icon name={item.icon} size={11} className="relative z-10" /> : null}
            <span className="relative z-10">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block text-[10px] text-text-muted uppercase tracking-wider">{label}</label>
      {children}
      {hint ? <div className="text-[10px] text-text-muted">{hint}</div> : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cn(
        "w-full bg-void border border-border px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent outline-none transition-colors duration-150",
        className,
      )}
    />
  );
}

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange?.(!checked)}
      className={cn(
        "relative w-10 h-5 border transition-colors",
        checked ? "bg-accent border-accent" : "bg-transparent border-border-light",
      )}
      aria-pressed={checked}
    >
      <motion.span
        className="absolute top-0.5 w-4 h-4 bg-void"
        animate={{ x: checked ? 22 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex gap-2.5 select-none",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cn(
          "mt-px w-4 h-4 shrink-0 flex items-center justify-center border transition-colors duration-150",
          checked
            ? "bg-accent border-accent text-void"
            : "bg-void border-border-light hover:border-text-muted",
        )}
      >
        {checked ? <Icon name="check" size={11} /> : null}
      </button>
      <span className="min-w-0 leading-snug">
        <span className="text-sm text-text-primary">{label}</span>
        {hint ? (
          <span className="block text-[11px] text-text-muted mt-1 leading-snug">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

export interface MotionRowProps extends MotionProps {
  className?: string;
  delay?: number;
}

export function MotionRow({ className, delay = 0, children, ...rest }: MotionRowProps & { children?: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay, ease: EASE }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function RefreshButton({
  label,
  onClick,
  variant = "ghost",
  durationMs = 900,
}: {
  label: string;
  onClick?: () => void;
  variant?: ButtonVariant;
  durationMs?: number;
}) {
  const [spinning, setSpinning] = React.useState(false);
  const handleClick = () => {
    if (spinning) return;
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), durationMs);
    onClick?.();
  };
  return (
    <Button variant={variant} onClick={handleClick}>
      <motion.span
        animate={spinning ? { rotate: 360 } : { rotate: 0 }}
        transition={spinning ? { duration: durationMs / 1000, ease: "linear", repeat: Infinity } : { duration: 0 }}
        className="flex items-center"
      >
        <Icon name="refresh" size={12} />
      </motion.span>
      {label}
    </Button>
  );
}
