import React from 'react'
import { motion } from 'framer-motion'
import { FileText, Check } from 'lucide-react'

/**
 * FileItem — file reading card with filename, icon, and success message.
 *
 * @param {string} fileName
 * @param {string} [subtitle]    — optional secondary label
 * @param {string} [successText] — e.g. "Successfully read"
 * @param {"loading"|"complete"} [status]
 */
export default function FileItem({
  fileName,
  subtitle,
  successText = 'Successfully read',
  status = 'complete',
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="mt-2.5"
    >
      {/* "Reviewing source" label */}
      <span className="text-[11px] font-medium uppercase tracking-widest text-white/40 mb-2 block">
        Reviewing source
      </span>

      <div
        className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl
                    bg-white/4 border border-white/8"
      >
        {/* File icon */}
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/6">
          <FileText className="w-4 h-4 text-white/50" />
        </div>

        {/* File name + subtitle */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-white/80 font-medium truncate">{fileName}</p>
          {subtitle && (
            <p className="text-[11px] text-white/35 truncate">{subtitle}</p>
          )}
        </div>

        {/* Success indicator */}
        {status === 'complete' && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.2 }}
            className="flex items-center gap-1 text-emerald-400/80 shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
            <span className="text-[11px]">{successText}</span>
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}
