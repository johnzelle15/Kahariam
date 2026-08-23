export function Skeleton({ className = '', width = '100%', height = 20 }) {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        background:
          'linear-gradient(90deg, var(--skeleton-from) 25%, var(--skeleton-via) 37%, var(--skeleton-from) 63%)',
        backgroundSize: '400% 100%',
        animation: 'shimmer 1.4s ease infinite',
        borderRadius: '0.75rem',
      }}
    />
  )
}

export default function LoadingState({ rows = 3 }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={64} />
      ))}
    </div>
  )
}
