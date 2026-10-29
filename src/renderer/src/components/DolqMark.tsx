/** The Dolq dagger, drawn in the current text colour with no background of its own (the app icon's mark, on transparent). */
export function DolqMark({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="186 60 140 340" fill="currentColor" className={className}>
      <polygon points="256,72 281,218 271,236 271,247 256,255 241,247 241,236 231,218" />
      <rect x="220" y="256" width="72" height="16" />
      <rect x="199" y="276" width="113" height="16" />
      <rect x="246" y="302" width="20" height="63" rx="6" />
      <circle cx="256" cy="373" r="18" />
    </svg>
  );
}
