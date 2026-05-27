interface IconProps {
  className?: string;
}

function SvgIcon({
  className = "h-4 w-4",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function BoltIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M13 2 4.8 13.2a.7.7 0 0 0 .57 1.1H11l-1 7.7 8.2-11.2a.7.7 0 0 0-.57-1.1H12z" />
    </SvgIcon>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="m5 12 4.2 4.2L19 6.5" />
    </SvgIcon>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="m6 9 6 6 6-6" />
    </SvgIcon>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </SvgIcon>
  );
}

export function EyeIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </SvgIcon>
  );
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M3 3l18 18" />
      <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.3 0 9.5 7 9.5 7a15 15 0 0 1-2.2 3.1" />
      <path d="M14.1 14.1A3 3 0 0 1 9.9 9.9" />
      <path d="M6.6 6.6C3.9 8.5 2.5 12 2.5 12s3.2 7 9.5 7c1.5 0 2.8-.4 3.9-1" />
    </SvgIcon>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M5 7h14M5 12h14M5 17h14" />
    </SvgIcon>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M20 14.6A7.5 7.5 0 0 1 9.4 4a8.5 8.5 0 1 0 10.6 10.6Z" />
    </SvgIcon>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18.4 9A7 7 0 0 0 6.2 6.8L4 9" />
      <path d="M5.6 15a7 7 0 0 0 12.2 2.2L20 15" />
    </SvgIcon>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </SvgIcon>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 14h10l1-14" />
      <path d="M9 7V4h6v3" />
    </SvgIcon>
  );
}

export function UserIcon({ className }: IconProps) {
  return (
    <SvgIcon className={className}>
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="8" r="4" />
    </SvgIcon>
  );
}
