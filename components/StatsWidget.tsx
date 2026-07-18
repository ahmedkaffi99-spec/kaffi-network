interface StatsWidgetProps {
  label: string
  value: string | number
  sub?: string
  trend?: 'up' | 'down' | 'neutral'
  icon?: string
  highlight?: boolean
}

export function StatsWidget({ label, value, sub, trend, icon, highlight }: StatsWidgetProps) {
  const trendColors = { up: 'text-emerald-400', down: 'text-red-400', neutral: 'text-gray-400' }
  const trendIcons = { up: '↑', down: '↓', neutral: '→' }

  return (
    <div
      className={`rounded-2xl p-5 border transition-all duration-200 ${
        highlight
          ? 'bg-gold-500/8 border-gold-500/25 shadow-lg shadow-gold-500/5'
          : 'bg-navy-800/60 border-navy-700/50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">
            {label}
          </div>
          <div className={`text-3xl font-bold tabular-nums ${highlight ? 'text-gold-400' : 'text-white'}`}>
            {value}
          </div>
          {sub && (
            <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
              {trend && (
                <span className={trendColors[trend]}>{trendIcons[trend]}</span>
              )}
              {sub}
            </div>
          )}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-xl bg-navy-700/60 flex items-center justify-center text-xl flex-shrink-0">
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
