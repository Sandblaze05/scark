'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

/**
 * ReasoningBlock — natural-language reasoning with typing effect + collapsible.
 *
 * @param {string}   text           — full reasoning text (plain text / markdown-lite)
 * @param {string[]} [bullets]      — optional bullet points
 * @param {boolean}  [enableTyping] — if true, characters appear progressively
 * @param {number}   [typingSpeed]  — ms per character (default 12)
 * @param {number}   [collapsedLines] — lines to show before "Show more" (default 6)
 */
export default function ReasoningBlock({
  text = '',
  bullets = [],
  enableTyping = true,
  typingSpeed = 12,
  collapsedLines = 6,
}) {
  const [displayedText, setDisplayedText] = useState(enableTyping ? '' : text)
  const [isTypingDone, setIsTypingDone] = useState(!enableTyping)
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef(null)
  const [needsCollapse, setNeedsCollapse] = useState(false)

  // Typing effect
  useEffect(() => {
    if (!enableTyping || !text) {
      setDisplayedText(text)
      setIsTypingDone(true)
      return
    }

    let i = 0
    setDisplayedText('')
    setIsTypingDone(false)

    const interval = setInterval(() => {
      i++
      setDisplayedText(text.slice(0, i))
      if (i >= text.length) {
        clearInterval(interval)
        setIsTypingDone(true)
      }
    }, typingSpeed)

    return () => clearInterval(interval)
  }, [text, enableTyping, typingSpeed])

  // Check if content overflows and needs collapse
  const measureCollapse = useCallback(() => {
    if (contentRef.current) {
      const lineHeight = 22 // approx line height in px
      const maxCollapsedHeight = lineHeight * collapsedLines
      setNeedsCollapse(contentRef.current.scrollHeight > maxCollapsedHeight + 10)
    }
  }, [collapsedLines])

  useEffect(() => {
    measureCollapse()
  }, [displayedText, bullets, measureCollapse])

  const lineHeight = 22
  const maxCollapsedHeight = lineHeight * collapsedLines

  return (
    <div className="mt-1">
      {/* Text content */}
      <div
        ref={contentRef}
        className="relative overflow-hidden transition-[max-height] duration-300 ease-in-out"
        style={{
          maxHeight:
            !needsCollapse || expanded
              ? '2000px'
              : `${maxCollapsedHeight}px`,
        }}
      >
        <p className="text-[14px] leading-[22px] text-white/75 whitespace-pre-wrap">
          {displayedText}
          {!isTypingDone && (
            <span className="inline-block w-[2px] h-[14px] bg-white/60 ml-0.5 align-middle timeline-typing-cursor" />
          )}
        </p>

        {/* Bullet points */}
        {bullets.length > 0 && (
          <ul className="mt-3 space-y-1.5 list-none">
            {bullets.map((bullet, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: enableTyping ? (text.length * typingSpeed) / 1000 + i * 0.1 : i * 0.08 }}
                className="flex items-start gap-2 text-[13px] leading-[20px] text-white/65"
              >
                <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-white/30 shrink-0" />
                <span>{bullet}</span>
              </motion.li>
            ))}
          </ul>
        )}

        {/* Gradient fade when collapsed */}
        {needsCollapse && !expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-linear-to-t from-[#0a0a0a] to-transparent pointer-events-none" />
        )}
      </div>

      {/* Show more / less toggle */}
      {needsCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 text-[12px] text-white/40 hover:text-white/60
                     transition-colors duration-200 cursor-pointer group"
        >
          <span>{expanded ? 'Show less' : 'Show more'}</span>
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>
      )}
    </div>
  )
}
