export default function WealthLoading() {
  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <div className="h-8 w-24 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-4 w-40 bg-slate-100 dark:bg-slate-800 rounded" />
        </div>
        <div className="h-9 w-28 bg-slate-200 dark:bg-slate-700 rounded-lg" />
      </div>

      {/* Net worth hero card */}
      <div className="rounded-xl bg-slate-200 dark:bg-slate-700 p-6 mb-6">
        <div className="h-3 w-20 bg-slate-300 dark:bg-slate-600 rounded mb-2" />
        <div className="h-10 w-40 bg-slate-300 dark:bg-slate-600 rounded-lg mb-4" />
        <div className="flex gap-8">
          <div className="space-y-1">
            <div className="h-3 w-12 bg-slate-300 dark:bg-slate-600 rounded" />
            <div className="h-5 w-20 bg-slate-300 dark:bg-slate-600 rounded" />
          </div>
          <div className="space-y-1">
            <div className="h-3 w-12 bg-slate-300 dark:bg-slate-600 rounded" />
            <div className="h-5 w-20 bg-slate-300 dark:bg-slate-600 rounded" />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-1 h-9 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        ))}
      </div>

      {/* Asset breakdown card */}
      <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-5 mb-4">
        <div className="h-5 w-36 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="flex justify-between mb-1">
                <div className="h-3 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
                <div className="h-3 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
              </div>
              <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Debt breakdown card */}
      <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-5">
        <div className="h-5 w-36 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <div className="flex justify-between mb-1">
                <div className="h-3 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
                <div className="h-3 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
              </div>
              <div className="h-2 w-32 bg-slate-100 dark:bg-slate-800 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
