'use client'

import React from 'react'
import { motion } from 'framer-motion'
import {
  Loader2,
  CheckCircle2,
  Search,
  FileText,
  Brain,
  CircleDot,
  CircleCheck,
} from 'lucide-react'
import SearchChips from './SearchChips'
import FileItem from './FileItem'
import ReasoningBlock from './ReasoningBlock'

/* ------------------------------------------------------------------ */
/*  Icon + colour for each step type × status                         */
/* ------------------------------------------------------------------ */
const STEP_CONFIG = {
  status: {
    loading: { Icon: Loader2, color: 'text-violet-400', spin: true },
    complete: { Icon: CircleDot, color: 'text-white/50', spin: false },
  },
  search: {
    loading: { Icon: Search, color: 'text-sky-400', spin: false },
    complete: { Icon: Search, color: 'text-white/50', spin: false },
  },
  file: {
    loading: { Icon: FileText, color: 'text-amber-400', spin: false },
    complete: { Icon: FileText, color: 'text-white/50', spin: false },
  },
  reasoning: {
    loading: { Icon: Brain, color: 'text-violet-400', spin: false },
    complete: { Icon: Brain, color: 'text-white/50', spin: false },
  },
  done: {
    loading: { Icon: Loader2, color: 'text-emerald-400', spin: true },
    complete: { Icon: CircleCheck, color: 'text-emerald-400', spin: false },
  },
}

/**
 * TimelineStep — single node on the vertical timeline.
 *
 * @param {object}  step         — step data object
 * @param {boolean} isLast       — true if this is the last visible step
 * @param {number}  index        — position index for animation stagger
 */
export default function TimelineStep({ step, isLast = false, index = 0 }) {
  const { type, title, status, content } = step
  const cfg = STEP_CONFIG[type]?.[status] ?? STEP_CONFIG.status.complete
  const { Icon, color, spin } = cfg

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.45,
        ease: [0.22, 1, 0.36, 1],
        opacity: { duration: 0.3 },
      }}
      className="relative flex gap-4 group"
    >
      {/* ---- Left column: icon dot + vertical connector ---- */}
      <div className="flex flex-col items-center shrink-0 w-6">
        {/* Node circle */}
        <div className="relative flex items-center justify-center">
          {/* Pulse glow ring while loading */}
          {status === 'loading' && (
            <span className="absolute inset-[-4px] rounded-full timeline-pulse-glow" />
          )}

          <div
            className={`relative z-10 flex items-center justify-center
                        w-6 h-6 rounded-full
                        ${status === 'loading' ? 'bg-white/8' : 'bg-white/5'}
                        border ${status === 'loading' ? 'border-white/15' : 'border-white/8'}
                        transition-colors duration-300`}
          >
            <Icon
              className={`w-3 h-3 ${color} ${spin ? 'animate-spin' : ''}`}
            />
          </div>
        </div>

        {/* Vertical connector line */}
        {!isLast && (
          <div className="flex-1 w-px bg-linear-to-b from-white/10 to-transparent min-h-6" />
        )}
      </div>

      {/* ---- Right column: content ---- */}
      <div className="flex-1 pb-6 min-w-0">
        {/* Title */}
        <p
          className={`text-[14px] leading-6 font-medium
                      ${status === 'loading' ? 'text-white/80' : 'text-white/55'}
                      transition-colors duration-300`}
        >
          {title}
        </p>

        {/* Type-specific content */}
        {type === 'status' && content?.description && (
          <div className="mt-2 px-3.5 py-2.5 rounded-xl bg-white/3 border border-white/6">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/6">
                <FileText className="w-3.5 h-3.5 text-white/40" />
              </div>
              <span className="text-[13px] text-white/60 font-medium">{content.description}</span>
            </div>
            {content.result && (
              <div className="flex items-center gap-1.5 mt-2 ml-9.5 text-emerald-400/70">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="text-[12px]">{content.result}</span>
              </div>
            )}
          </div>
        )}

        {type === 'search' && content?.queries && (
          <SearchChips queries={content.queries} />
        )}

        {type === 'file' && content?.files?.map((file, i) => (
          <FileItem
            key={i}
            fileName={file.name}
            subtitle={file.subtitle}
            successText={file.successText}
            status={status}
          />
        ))}

        {type === 'reasoning' && (
          <ReasoningBlock
            text={content?.text || ''}
            bullets={content?.bullets || []}
            enableTyping={status === 'loading'}
            collapsedLines={content?.collapsedLines || 6}
          />
        )}

        {type === 'done' && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-[12px] text-white/30 mt-0.5"
          >
            {content?.summary || 'Task completed'}
          </motion.p>
        )}

        {/* Timestamp */}
        {step.timestamp && (
          <p className="text-[10px] text-white/20 mt-2 tabular-nums">{step.timestamp}</p>
        )}
      </div>
    </motion.div>
  )
}
