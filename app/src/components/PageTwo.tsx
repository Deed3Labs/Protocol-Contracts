import { BarChart3, PieChart, LineChart, TrendingUp, DollarSign, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

function PageTwo() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-orange-50 dark:from-gray-950 dark:via-gray-900 dark:to-orange-950 transition-colors duration-500">
      <div className="container mx-auto px-6 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-sm font-medium mb-6 border border-orange-200 dark:border-orange-800">
              <BarChart3 className="w-4 h-4 mr-2" />
              Analytics Dashboard
            </div>
            
            <h1 className="text-5xl font-bold bg-gradient-to-r from-gray-900 via-orange-800 to-red-800 dark:from-white dark:via-orange-200 dark:to-red-200 bg-clip-text text-transparent mb-4 leading-tight">
              Protocol Analytics
            </h1>
            
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
              Real-time insights and analytics for the digital asset ecosystem.
            </p>
          </div>
          
          {/* Analytics Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {/* Total Value Locked */}
            <div className="lg:col-span-2 p-8 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mr-4">
                    <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Total Value Locked</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-300">Across all assets</p>
                  </div>
                </div>
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">+24.8%</span>
              </div>
              
              <div className="mb-4">
                <div className="text-4xl font-bold text-gray-900 dark:text-white mb-2">$12.4M</div>
                <div className="text-sm text-gray-600 dark:text-gray-300">+$2.1M from last month</div>
              </div>
              
              {/* Mock Chart Area */}
              <div className="h-32 bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/20 dark:to-purple-900/20 rounded-xl flex items-end justify-center p-4">
                <div className="flex items-end space-x-2 h-full">
                  {[40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88].map((height, i) => (
                    <div 
                      key={i} 
                      className="bg-gradient-to-t from-blue-500 to-purple-500 rounded-sm w-3 opacity-80"
                      style={{ height: `${height}%` }}
                    ></div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Asset Distribution */}
            <div className="p-8 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-gray-200 dark:border-gray-700">
              <div className="flex items-center mb-6">
                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mr-4">
                  <PieChart className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Asset Types</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">Distribution</p>
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-blue-500 rounded-full mr-3"></div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">Land</span>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">45%</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-purple-500 rounded-full mr-3"></div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">Estate</span>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">30%</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">Vehicle</span>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">15%</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-3 h-3 bg-orange-500 rounded-full mr-3"></div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">Equipment</span>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">10%</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Recent Activity */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-8 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-gray-200 dark:border-gray-700">
              <div className="flex items-center mb-6">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center mr-4">
                  <Activity className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Activity</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">Latest transactions</p>
                </div>
              </div>
              
              <div className="space-y-4">
                {[
                  { type: "Mint", asset: "Land #1234", time: "2 min ago", status: "success" },
                  { type: "Validate", asset: "Estate #5678", time: "5 min ago", status: "success" },
                  { type: "Transfer", asset: "Vehicle #9012", time: "12 min ago", status: "pending" },
                  { type: "Mint", asset: "Equipment #3456", time: "18 min ago", status: "success" }
                ].map((activity, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-3 ${activity.status === 'success' ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{activity.type}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">{activity.asset}</p>
                      </div>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{activity.time}</span>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Performance Metrics */}
            <div className="p-8 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-gray-200 dark:border-gray-700">
              <div className="flex items-center mb-6">
                <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center mr-4">
                  <LineChart className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Performance</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">Key metrics</p>
                </div>
              </div>
              
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600 dark:text-gray-300">Validation Rate</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">94.2%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full" style={{ width: '94.2%' }}></div>
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600 dark:text-gray-300">Network Uptime</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">99.9%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: '99.9%' }}></div>
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600 dark:text-gray-300">User Satisfaction</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">96.8%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-purple-500 h-2 rounded-full" style={{ width: '96.8%' }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Coming Soon Section */}
          <div className="mt-12 text-center p-12 rounded-2xl bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm border border-gray-200 dark:border-gray-700">
            <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <BarChart3 className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Advanced Analytics Coming Soon</h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 mb-8 max-w-2xl mx-auto">
              Comprehensive analytics dashboard with real-time data visualization, custom reports, and predictive insights.
            </p>
            <Button className="px-8 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200">
              Join Beta
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PageTwo; 