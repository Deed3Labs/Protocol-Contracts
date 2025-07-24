import { Search, TrendingUp, Activity, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function PageOne() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-green-50 dark:from-gray-950 dark:via-gray-900 dark:to-green-950 transition-colors duration-500">
      <div className="container mx-auto px-6 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm font-medium mb-6 border border-green-200 dark:border-green-800">
              <Search className="w-4 h-4 mr-2" />
              Asset Explorer
            </div>
            
            <h1 className="text-5xl font-bold bg-gradient-to-r from-gray-900 via-green-800 to-blue-800 dark:from-white dark:via-green-200 dark:to-blue-200 bg-clip-text text-transparent mb-4 leading-tight">
              Explore Digital Assets
            </h1>
            
            <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto leading-relaxed">
              Discover, analyze, and track digital assets across the protocol ecosystem.
            </p>
          </div>
          
          {/* Search Bar */}
          <div className="max-w-2xl mx-auto mb-12">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input 
                placeholder="Search assets by ID, owner, or type..." 
                className="pl-12 py-4 text-lg bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-gray-200 dark:border-gray-700 rounded-xl"
              />
            </div>
          </div>
          
          {/* Stats Cards */}
          <div className="grid md:grid-cols-3 gap-6 mb-12">
            <div className="p-6 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">+12.5%</span>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">2,847</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">Total Assets</p>
            </div>
            
            <div className="p-6 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                  <Activity className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">+8.2%</span>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">1,234</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">Validated Assets</p>
            </div>
            
            <div className="p-6 rounded-2xl bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                  <Users className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">+15.7%</span>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">892</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">Active Owners</p>
            </div>
          </div>
          
          {/* Coming Soon Section */}
          <div className="text-center p-12 rounded-2xl bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm border border-gray-200 dark:border-gray-700">
            <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Search className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Advanced Explorer Coming Soon</h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 mb-8 max-w-2xl mx-auto">
              We're building powerful tools to help you explore, filter, and analyze digital assets across the entire protocol ecosystem.
            </p>
            <Button className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200">
              Get Notified
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PageOne; 