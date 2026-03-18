'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { Loader2, CheckCircle2 } from 'lucide-react'

/**
 * StatusBadge — tiny indicator showing loading spinner or completed check.
 *
 * @param {"loading"|"complete"} status
 * @param {string} [className]
 */
export default function StatusBadge({ status = 'complete', className = '' }) {
  if (status === 'loading') {
    return (
      <motion.div
        className={`relative flex items-center justify-center ${className}`}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
      >
        <Loader2 className="w-4 h-4 text-violet-400" />
      </motion.div>
    )
  }

  return (
    <motion.div
      className={`flex items-center justify-center ${className}`}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
    >
      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
    </motion.div>
  )
}
