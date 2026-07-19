import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/Header'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { StatsWidget } from '@/components/StatsWidget'
import type { BetPerformance } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function StatsPage() {
  const supabase = await createClient()

  const [{ data: picks }, { data: performance }] = await Promise.all([
    supabase
      .from('picks')
      .select('result, odds, was_rejected, created_at')
      .eq('was_rejected', false)
      .not('result', 'is', null),
    supabase
      .from('bet_performance')
      .select('*')
      .order('total_picks', { ascending: false })
      .limit(20),
  ])

  const allPicks = picks ?? []
  const wins = allPicks.filter(p => p.result === 'win').length
  const losses = allPicks.filter(p => p.result === 'loss').length
  const voids = allPicks.filter(p => p.result === 'void').length
  const total = wins + losses
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0

  const betPerf = (performance ?? []) as BetPerformance[]
  const maxWr = betPerf.length > 0 ? Math.max(...betPerf.map(p => p.total_picks > 0 ? Math.round((p.wins / p.total_picks) * 100) : 0)) : 100

  return (
    <div>
      <Header title="Statistiques" subtitle="Performances et historique des résultats" />

      <div className="p-8 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsWidget label="Total picks" value={allPicks.length} sub="Résultats connus" icon="📋" />
          <StatsWidget label="Taux de réussite" value={`${winRate}%`} sub={`${wins}W / ${losses}L / ${voids} nuls`} highlight icon="🎯" />
          <StatsWidget label="Victoires" value={wins} sub="Picks gagnants" trend="up" icon="✅" />
          <StatsWidget label="Défaites" value={losses} sub="Picks perdants" icon="❌" />
        </div>

        {/* Performance par type de pari */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-white text-sm">Performance par type de pari</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {betPerf.length === 0 ? (
              <p className="text-gray-600 text-sm">Aucune donnée de performance disponible.</p>
            ) : (
              betPerf.filter(p => p.total_picks >= 1).map(p => {
                const wr = p.total_picks > 0 ? Math.round((p.wins / p.total_picks) * 100) : 0
                return (
                  <div key={`${p.bet_type}-${p.competition}`} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-white font-medium truncate">{p.bet_type}</span>
                        <span className="text-xs text-gray-500 ml-2 flex-shrink-0">{p.competition}</span>
                      </div>
                      <div className="h-6 bg-navy-900/60 border border-navy-700/30 rounded-lg overflow-hidden relative">
                        <div
                          className="h-full flex items-center rounded-lg transition-all duration-700"
                          style={{
                            width: `${maxWr > 0 ? (wr / maxWr) * 100 : 0}%`,
                            background: 'linear-gradient(90deg, rgba(201,163,92,0.15), rgba(201,163,92,0.35))',
                            borderRight: '2px solid rgba(201,163,92,0.7)',
                          }}
                        >
                          <span className="text-xs text-gold-400 font-bold ml-auto pr-2">{wr}%</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-gray-600 flex-shrink-0 w-14 text-right">
                      {p.wins}W {p.losses}L
                    </span>
                  </div>
                )
              })
            )}
          </CardBody>
        </Card>

        {/* Table détaillée */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-white text-sm">Mémoire des types de paris</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-navy-700/50">
                <tr>
                  {['Type de pari', 'Compétition', 'Total', 'W', 'L', 'Void', 'Win Rate', 'Cote moy.'].map(h => (
                    <th key={h} className="text-left text-xs text-gray-500 py-3 px-4 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {betPerf.map((p, i) => {
                  const wr = p.total_picks > 0 ? Math.round((p.wins / p.total_picks) * 100) : 0
                  return (
                    <tr key={`${p.bet_type}-${p.competition}-${i}`} className="border-b border-navy-700/20 hover:bg-navy-700/10 transition">
                      <td className="py-3 px-4 text-sm font-medium text-white">{p.bet_type}</td>
                      <td className="py-3 px-4 text-sm text-gray-400">{p.competition}</td>
                      <td className="py-3 px-4 text-sm text-gray-400">{p.total_picks}</td>
                      <td className="py-3 px-4 text-sm text-emerald-400 font-semibold">{p.wins}</td>
                      <td className="py-3 px-4 text-sm text-red-400">{p.losses}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{p.voids}</td>
                      <td className="py-3 px-4">
                        <span className={`text-sm font-bold ${wr >= 65 ? 'text-gold-400' : 'text-gray-400'}`}>{wr}%</span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-400">{p.avg_odds?.toFixed(2) ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
