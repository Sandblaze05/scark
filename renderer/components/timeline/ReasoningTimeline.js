import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TimelineStep from './TimelineStep'

/**
 * ReasoningTimeline — main timeline container.
 *
 * Renders steps progressively (streaming simulation) and auto-scrolls.
 *
 * @param {object[]} steps         — full array of step objects
 * @param {boolean}  [streaming]   — if true, steps appear one-by-one with delay
 * @param {number}   [streamDelay] — ms between each step reveal (default 800)
 * @param {function} [onStepReveal]— callback fired when a new step is revealed
 */
export default function ReasoningTimeline({
  steps = [],
  streaming = true,
  streamDelay = 800,
  onStepReveal,
}) {
  const [visibleCount, setVisibleCount] = useState(streaming ? 0 : steps.length)
  const containerRef = useRef(null)
  const prevStepsLenRef = useRef(0)

  // Progressive reveal
  useEffect(() => {
    if (!streaming) {
      setVisibleCount(steps.length)
      return
    }

    // When new steps are added externally, reveal them one-by-one
    if (steps.length > prevStepsLenRef.current) {
      const startFrom = prevStepsLenRef.current
      prevStepsLenRef.current = steps.length

      let i = startFrom
      const reveal = () => {
        if (i < steps.length) {
          setVisibleCount(i + 1)
          onStepReveal?.(i)
          i++
          setTimeout(reveal, streamDelay)
        }
      }

      // kick-off with a small initial delay
      setTimeout(reveal, i === 0 ? 200 : streamDelay)
    }
  }, [steps.length, streaming, streamDelay, onStepReveal])

  const visibleSteps = steps.slice(0, visibleCount)

  // Determine if the last visible step is in a "loading" state
  // to transition it to complete when the next step arrives
  const stepsWithStatus = visibleSteps.map((step, i) => {
    // If step is explicitly marked, keep it. Otherwise auto-infer:
    // the last visible step stays "loading" until the next one reveals.
    if (step.status) return step
    const isLastVisible = i === visibleSteps.length - 1
    return {
      ...step,
      status: isLastVisible && i < steps.length - 1 ? 'loading' : 'complete',
    }
  })

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-2xl mx-auto overflow-hidden pr-2"
    >
      <AnimatePresence mode="popLayout">
        {stepsWithStatus.map((step, i) => (
          <TimelineStep
            key={step.id ?? `step-${i}`}
            step={step}
            isLast={i === stepsWithStatus.length - 1}
            index={i}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}
