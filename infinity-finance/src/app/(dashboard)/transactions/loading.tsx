export default function TransactionsLoading() {
  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <div className="h-8 w-40 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-4 w-52 bg-slate-100 dark:bg-slate-800 rounded" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-9 w-32 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-9 w-20 bg-slate-200 dark:bg-slate-700 rounded-lg" />
        </div>
      </div>

      {/* Transaction list */}
      <div className="rounded-xl border border-slate-100 dark:border-slate-800 divide-y divide-slate-50 dark:divide-slate-800">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <div className="h-9 w-9 bg-slate-200 dark:bg-slate-700 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-2 w-32 bg-slate-100 dark:bg-slate-800 rounded" />
            </div>
            <div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
            <div className="flex gap-1">
              <div className="h-8 w-8 bg-slate-100 dark:bg-slate-800 rounded-lg" />
              <div className="h-8 w-8 bg-slate-100 dark:bg-slate-800 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
