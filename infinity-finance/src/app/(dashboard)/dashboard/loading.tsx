export default function DashboardLoading() {
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <div className="h-8 w-36 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          <div className="h-4 w-48 bg-slate-100 dark:bg-slate-800 rounded" />
        </div>
        <div className="h-9 w-32 bg-slate-200 dark:bg-slate-700 rounded-lg" />
      </div>

      {/* KPI cards row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-100 dark:border-slate-800 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="h-3 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-8 w-8 bg-slate-200 dark:bg-slate-700 rounded-xl" />
            </div>
            <div className="h-7 w-24 bg-slate-200 dark:bg-slate-700 rounded-lg" />
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Recent transactions card */}
          <div className="rounded-xl border border-slate-100 dark:border-slate-800">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <div className="h-5 w-40 bg-slate-200 dark:bg-slate-700 rounded" />
            </div>
            <div className="divide-y divide-slate-50 dark:divide-slate-800">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-9 w-9 bg-slate-200 dark:bg-slate-700 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-36 bg-slate-200 dark:bg-slate-700 rounded" />
                    <div className="h-2 w-24 bg-slate-100 dark:bg-slate-800 rounded" />
                  </div>
                  <div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
                </div>
              ))}
            </div>
          </div>

          {/* Budget overview card */}
          <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-5">
            <div className="h-5 w-20 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i}>
                  <div className="flex justify-between mb-1.5">
                    <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
                    <div className="h-3 w-24 bg-slate-100 dark:bg-slate-800 rounded" />
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Net worth card */}
          <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-5">
            <div className="h-5 w-24 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
            <div className="h-9 w-32 bg-slate-200 dark:bg-slate-700 rounded-lg mb-4" />
            <div className="space-y-2">
              <div className="flex justify-between">
                <div className="h-3 w-12 bg-slate-100 dark:bg-slate-800 rounded" />
                <div className="h-3 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
              </div>
              <div className="flex justify-between">
                <div className="h-3 w-12 bg-slate-100 dark:bg-slate-800 rounded" />
                <div className="h-3 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
              </div>
              <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full mt-3" />
            </div>
          </div>

          {/* Bills widget */}
          <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-5">
            <div className="h-5 w-16 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
            <div className="divide-y divide-slate-50 dark:divide-slate-800">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <div className="h-5 w-5 bg-slate-200 dark:bg-slate-700 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
                  </div>
                  <div className="h-3 w-12 bg-slate-200 dark:bg-slate-700 rounded" />
                </div>
              ))}
            </div>
          </div>

          {/* Goals widget */}
          <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-5">
            <div className="h-5 w-16 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
            <div className="space-y-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i}>
                  <div className="flex justify-between mb-1.5">
                    <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
                    <div className="h-3 w-10 bg-slate-100 dark:bg-slate-800 rounded" />
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
