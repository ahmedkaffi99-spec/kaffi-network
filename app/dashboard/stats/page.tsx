import { Header } from '@/components/Header'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { StatsWidget } from '@/components/StatsWidget'
import { mockMonthlyStats, mockStats } from '@/lib/mock-data'

export default function StatsPage() {
  const maxWinRate = Math.max(...mockMonthlyStats.map(s => s.win_rate))
  const maxROI = Math.max(...mockMonthlyStats.map(s => s.roi))

  return (
    <div>
      <Header
        title="Statistiques"
        subtitle="Performances et historique des résultats"
      />

      <div className="p-8 space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsWidget
            label="Taux de réussite"
            value={`${mockStats.win_rate}%`}
            sub="Juillet 2025"
            highlight
            icon="🎯"
          />
          <StatsWidget
            label="ROI mensuel"
            value={`+${mockStats.roi_this_month}%`}
            sub="Objectif +10%"
            trend="up"
            icon="📈"
          />
          <StatsWidget
            label="Série actuelle"
            value={`${mockStats.current_streak}W`}
            sub="Victoires consécutives"
            trend="up"
            icon="🔥"
          />
          <StatsWidget
            label="Total publiés"
            value={mockStats.total_this_month}
            sub="Ce mois-ci"
            icon="📤"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Win rate bar chart */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-white text-sm">Taux de réussite mensuel</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              {mockMonthlyStats.map(stat => (
                <div key={stat.month} className="flex items-center gap-3">
                  <span className="w-8 text-xs text-gray-500 flex-shrink-0 font-medium">
                    {stat.month}
                  </span>
                  <div className="flex-1 h-7 bg-navy-900/60 border border-navy-700/30 rounded-lg overflow-hidden relative">
                    <div
                      className="h-full flex items-center transition-all duration-700 rounded-lg"
                      style={{
                        width: `${(stat.win_rate / maxWinRate) * 100}%`,
                        background:
                          'linear-gradient(90deg, rgba(201,163,92,0.15), rgba(201,163,92,0.35))',
                        borderRight: '2px solid rgba(201,163,92,0.7)',
                      }}
                    >
                      <span className="text-xs text-gold-400 font-bold ml-auto pr-2">
                        {stat.win_rate}%
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-600 flex-shrink-0 w-14 text-right">
                    {stat.wins}W {stat.losses}L
                  </span>
                </div>
              ))}
            </CardBody>
          </Card>

          {/* ROI bar chart */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-white text-sm">ROI mensuel</h2>
            </CardHeader>
            <CardBody>
              <div className="flex items-end gap-3 h-44">
                {mockMonthlyStats.map(stat => {
                  const heightPct = (stat.roi / maxROI) * 100
                  return (
                    <div key={stat.month} className="flex-1 flex flex-col items-center gap-2 h-full">
                      <div className="text-xs text-gold-400 font-bold">+{stat.roi}%</div>
                      <div className="flex-1 w-full flex items-end">
                        <div
                          className="w-full rounded-t-lg transition-all duration-700"
                          style={{
                            height: `${heightPct}%`,
                            background:
                              'linear-gradient(180deg, rgba(201,163,92,0.6) 0%, rgba(201,163,92,0.2) 100%)',
                            borderTop: '2px solid rgba(201,163,92,0.8)',
                          }}
                        />
                      </div>
                      <div className="text-xs text-gray-600">{stat.month}</div>
                    </div>
                  )
                })}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Detailed table */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-white text-sm">Historique détaillé</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-navy-700/50">
                <tr>
                  {['Mois', 'Total', 'Victoires', 'Défaites', 'Void', 'Win Rate', 'ROI'].map(h => (
                    <th key={h} className="text-left text-xs text-gray-500 py-3 px-5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mockMonthlyStats.map((stat, i) => (
                  <tr
                    key={stat.month}
                    className={`hover:bg-navy-700/15 transition ${
                      i < mockMonthlyStats.length - 1 ? 'border-b border-navy-700/30' : ''
                    }`}
                  >
                    <td className="py-3.5 px-5 text-sm font-medium text-white">
                      {stat.month} 2025
                    </td>
                    <td className="py-3.5 px-5 text-sm text-gray-400">{stat.total}</td>
                    <td className="py-3.5 px-5 text-sm text-emerald-400 font-semibold">
                      {stat.wins}
                    </td>
                    <td className="py-3.5 px-5 text-sm text-red-400">{stat.losses}</td>
                    <td className="py-3.5 px-5 text-sm text-gray-600">{stat.voids}</td>
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-navy-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gold-500 rounded-full"
                            style={{ width: `${stat.win_rate}%` }}
                          />
                        </div>
                        <span
                          className={`text-sm font-bold ${
                            stat.win_rate >= 65 ? 'text-gold-400' : 'text-gray-400'
                          }`}
                        >
                          {stat.win_rate}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-5 text-sm text-emerald-400 font-bold">
                      +{stat.roi}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
