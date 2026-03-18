'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { Search } from 'lucide-react'

/**
 * SearchChips — renders search queries as rounded pill chips.
 *
 * @param {string[]} queries — array of search query strings
 */
export default function SearchChips({ queries = [] }) {
  if (!queries.length) return null

  return (
    <div className="mt-2.5">
      <span className="text-[11px] font-medium uppercase tracking-widest text-white/40 mb-2 block">
        Searching
      </span>
      <div className="flex flex-wrap gap-2">
        {queries.map((query, i) => (
          <motion.div
            key={query}
            initial={{ opacity: 0, scale: 0.85, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3, ease: 'easeOut' }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                       bg-white/6 border border-white/8
                       text-[13px] text-white/70 select-none
                       hover:bg-white/10 hover:border-white/14 transition-colors duration-200"
          >
            <Search className="w-3 h-3 text-white/40 shrink-0" />
            <span>{query}</span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
