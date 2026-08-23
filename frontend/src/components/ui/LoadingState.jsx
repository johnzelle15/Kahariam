export function Skeleton({ className = '', width = '100%', height = 20 }) {
  return <div className={`skeleton-dark ${className}`} style={{ width, height }} />
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
