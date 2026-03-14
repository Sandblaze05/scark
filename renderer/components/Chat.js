'use client'

import React, { useRef, useState, useCallback, useEffect, useTransition, useMemo } from 'react'
import gsap from 'gsap'
import {
  ImageIcon,
  FileUp,
  Figma,
  MonitorIcon,
  CircleUserRound,
  ArrowUpIcon,
  Paperclip,
  PlusIcon,
  SendIcon,
  X,
  LoaderIcon,
  Sparkles,
  Command,
  Search,
  FlaskConical,
  Mic,
  Globe,
  Volume2,
  VolumeX,
  RefreshCw,
  ChevronDown,
  Lock,
  ArrowRight,
  Zap,
  Cpu,
  MessagesSquare,
  Bot,
  Sun,
  Wand2,
  ThumbsUp,
  ThumbsDown,
  GitBranch
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkExternalLinks from 'remark-external-links'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check } from 'lucide-react'
import { initEngine, streamChat as webllmStreamChat, complete as webllmComplete, DEFAULT_MODEL, planActions } from '../lib/webllm'
import { runAgentLoop } from '../lib/agentLoop'

const CodeBlock = React.memo(function CodeBlock({ language, value }) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    if (window.scark?.utils?.copyToClipboard) {
      window.scark.utils.copyToClipboard(value)
    } else {
      navigator.clipboard.writeText(value)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-white/5 bg-[#121212] shadow-sm group/code">
      <div className="flex items-center justify-between px-4 py-2 bg-[#1e1e1e] border-b border-white/5">
        <div className="flex items-center gap-2 opacity-60">
          <Command className="w-3 h-3" />
          <span className="text-[10px] font-medium uppercase tracking-wider">{language || 'code'}</span>
        </div>
        <button
          onClick={copyToClipboard}
          className="p-1.5 hover:bg-white/10 rounded-md transition-colors opacity-0 group-hover/code:opacity-100"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '1rem',
          fontSize: '0.85rem',
          backgroundColor: 'transparent',
        }}
        PreTag="div"
      >
        {value}
      </SyntaxHighlighter>
    </div>
  )
})

function FeedbackModal({ onClose, onSubmit }) {
  const [selectedTags, setSelectedTags] = useState([])
  const [details, setDetails] = useState('')
  
  const tags = [
    "Incorrect or incomplete",
    "Not what I asked for",
    "Slow or buggy",
    "Style or tone",
    "Safety or legal concern",
    "Other"
  ]
  
  const toggleTag = (tag) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }
  
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-[480px] bg-[#171717] border border-white/10 rounded-2xl p-6 shadow-2xl overflow-hidden relative"
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
        
        <h3 className="text-xl font-semibold text-white mb-6">Share feedback</h3>
        
        <div className="flex flex-wrap gap-2 mb-6">
          {tags.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={cn(
                "px-3 py-1.5 rounded-full text-sm border transition-all cursor-pointer",
                selectedTags.includes(tag)
                  ? "bg-white text-black border-white"
                  : "bg-transparent text-gray-300 border-white/20 hover:border-white/40"
              )}
            >
              {tag}
            </button>
          ))}
        </div>
        
        <textarea
          value={details}
          onChange={e => setDetails(e.target.value)}
          placeholder="Share details (optional)"
          className="w-full h-24 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all resize-none mb-6"
        />
        
        <div className="bg-white/5 rounded-xl p-4 mb-6 text-xs text-gray-400 leading-relaxed">
          Your conversation will be included with your feedback to help improve Scark. <a href="#" className="underline hover:text-white transition-colors">Learn more</a>
        </div>
        
        <div className="flex justify-end">
          <button
            onClick={() => onSubmit({ tags: selectedTags, details })}
            disabled={selectedTags.length === 0 && !details.trim()}
            className={cn(
              "px-6 py-2 rounded-full text-sm font-semibold transition-all cursor-pointer",
              (selectedTags.length > 0 || details.trim())
                ? "bg-white text-black hover:bg-gray-200"
                : "bg-white/10 text-gray-500 cursor-not-allowed"
            )}
          >
            Submit
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function useAutoResizeTextarea({ minHeight, maxHeight }) {
  const textareaRef = useRef(null)

  const adjustHeight = useCallback((reset) => {
    const textarea = textareaRef.current
    if (!textarea) return

    if (reset) {
      textarea.style.height = `${minHeight}px`
      return
    }

    // Temporarily reset height to 'auto' so scrollHeight accurately reflects the content dimension
    textarea.style.height = 'auto'
    const newHeight = Math.max(
      minHeight,
      Math.min(textarea.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY)
    )

    textarea.style.height = `${newHeight}px`
  }, [minHeight, maxHeight])

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) textarea.style.height = `${minHeight}px`
  }, [minHeight])

  useEffect(() => {
    const handleResize = () => adjustHeight()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [adjustHeight])

  return { textareaRef, adjustHeight }
}

const Textarea = React.forwardRef(({ className, containerClassName, showRing = true, ...props }, ref) => {
  const [isFocused, setIsFocused] = useState(false)
  return (
    <div className={cn("relative", containerClassName)}>
      <textarea
        className={cn(
          "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "transition-colors duration-200 ease-in-out placeholder:text-muted-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
          showRing ? "focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0" : "",
          className
        )}
        ref={ref}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        {...props}
      />
      {showRing && isFocused && (
        <motion.span
          className="absolute inset-0 rounded-md pointer-events-none ring-2 ring-offset-0 ring-violet-500/30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        />
      )}
    </div>
  )
})
Textarea.displayName = "Textarea"

function TypingDots() {
  return (
    <div className="flex items-center ml-1">
      {[1, 2, 3].map((dot) => (
        <motion.div
          key={dot}
          className="w-1.5 h-1.5 bg-foreground/90 rounded-full mx-0.5"
          initial={{ opacity: 0.3 }}
          animate={{ opacity: [0.3, 0.9, 0.3], scale: [0.85, 1.1, 0.85] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: dot * 0.15, ease: "easeInOut" }}
          style={{ boxShadow: "0 0 4px rgba(255, 255, 255, 0.3)" }}
        />
      ))}
    </div>
  )
}

function SoundWave({ levels }) {
  return (
    <div className="flex items-center gap-0.5 h-6 px-1">
      {levels.map((level, i) => (
        <div
          key={i}
          className="w-[2.5px] rounded-full bg-violet-400 dark:bg-violet-300"
          style={{
            height: `${Math.max(3, level * 24)}px`,
            opacity: 0.4 + level * 0.6,
            transition: 'height 80ms ease-out, opacity 80ms ease-out',
          }}
        />
      ))}
    </div>
  )
}

const AnimatedLogo = React.memo(({ mousePosition, className = '' }) => {
  const containerRef = useRef(null)
  const [rect, setRect] = useState(null)
  const [isBlinking, setIsBlinking] = useState(false)

  useEffect(() => {
    let blinkTimeout;
    const scheduleBlink = () => {
      const delay = Math.random() * 4000 + 2000;
      blinkTimeout = setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => {
          setIsBlinking(false);
          scheduleBlink();
        }, 120);
      }, delay);
    };
    scheduleBlink();
    return () => clearTimeout(blinkTimeout);
  }, []);

  useEffect(() => {
    let animationFrameId;
    const update = () => {
      if (containerRef.current) {
        setRect(containerRef.current.getBoundingClientRect())
      }
    }
    
    // Initial measure after a small delay to ensure DOM is settled
    const timeoutId = setTimeout(update, 50)
    
    const onResize = () => {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = requestAnimationFrame(update)
    }

    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, { passive: true })
    
    return () => {
      clearTimeout(timeoutId)
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize)
    }
  }, [])

  const centerX = rect ? rect.left + rect.width / 2 : 0
  const centerY = rect ? rect.top + rect.height / 2 : 0

  return (
    <div className={cn("flex justify-center mb-6 h-12", className)}>
      <div ref={containerRef} className="relative w-12 h-12 flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-10 h-10 overflow-visible text-black dark:text-white" xmlns="http://www.w3.org/2000/svg">
          {(() => {
            const dx = mousePosition.x - centerX
            const dy = mousePosition.y - centerY
            const dist = rect ? Math.sqrt(dx * dx + dy * dy) : 999
            
            const maxDist = 200
            const rawInfluence = Math.max(0, 1 - dist / maxDist)
            const influence = Math.pow(rawInfluence, 1.4)
            
            // Eye tracking math
            // Calculate direction of the mouse relative to the center
            const angle = Math.atan2(dy, dx)
            // Cap how far the eyes can move from the center of their sockets
            const maxEyeOffset = 1.2
            // Move eyes further when cursor is close, up to max offset
            const eyeDist = Math.min(dist / 40, maxEyeOffset) 
            const eyeOffsetX = Math.cos(angle) * eyeDist
            const eyeOffsetY = Math.sin(angle) * eyeDist

            return (
              <motion.g
                animate={{ 
                  scale: 1 + influence * 0.15
                }}
                transition={{ type: "spring", stiffness: 350, damping: 20 }}
                style={{ transformOrigin: "12px 12px" }}
              >
                <path
                  d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2057 5.9847 5.9847 0 0 0 3.989-2.9 6.051 6.051 0 0 0-.7388-7.0732z"
                  fill="currentColor"
                />
                <motion.circle
                  animate={{ 
                    cx: 9.5 + eyeOffsetX, 
                    cy: 10 + eyeOffsetY,
                    scaleY: isBlinking ? 0.1 : 1
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  r="1.5"
                  fill="white"
                  className="dark:fill-black"
                  style={{ transformOrigin: `${9.5 + eyeOffsetX}px ${10 + eyeOffsetY}px` }}
                />
                <motion.circle
                  animate={{ 
                    cx: 14.5 + eyeOffsetX, 
                    cy: 10 + eyeOffsetY,
                    scaleY: isBlinking ? 0.1 : 1
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  r="1.5"
                  fill="white"
                  className="dark:fill-black"
                  style={{ transformOrigin: `${14.5 + eyeOffsetX}px ${10 + eyeOffsetY}px` }}
                />
              </motion.g>
            )
          })()}
        </svg>
      </div>
    </div>
  )
})

const StarryIdleBackdrop = React.memo(function StarryIdleBackdrop() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const stars = useMemo(
    () => Array.from({ length: 70 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      bottom: Math.random() * 100,
      size: Math.random() * 1.9 + 0.5,
      alpha: Math.random() * 0.55 + 0.2,
      duration: Math.random() * 30 + 26,
      delay: Math.random() * -24,
      blur: Math.random() > 0.7 ? 0.3 : 0,
    })),
    [mounted]
  )

  if (!mounted) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="starfield-aurora-layer" />
      {stars.map((star) => (
        <span
          key={star.id}
          className="starfield-star"
          style={{
            '--star-left': `${star.left}%`,
            '--star-bottom': `${star.bottom}%`,
            '--star-size': `${star.size}px`,
            '--star-alpha': star.alpha,
            '--star-dur': `${star.duration}s`,
            '--star-delay': `${star.delay}s`,
            '--star-blur': `${star.blur}px`,
          }}
        />
      ))}
      <div className="starfield-vignette" />
    </div>
  )
})

export default function Chat({ isTemporary, setIsTemporary }) {
    // Dynamic roadmap state will be built during execution.


  const [value, setValue] = useState("")
  const [attachments, setAttachments] = useState([])
  const [isTyping, setIsTyping] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [followUpSuggestions, setFollowUpSuggestions] = useState([])
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight: 44, maxHeight: 200 })
  const [inputFocused, setInputFocused] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef(null)
  const messagesEndRef = useRef(null)
  const scrollContainerRef = useRef(null)
  const [isListening, setIsListening] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcriptionStatus, setTranscriptionStatus] = useState('')
  const [audioLevels, setAudioLevels] = useState(new Array(24).fill(0))

  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const preListenTextRef = useRef('')

  // Whisper variables
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const workerRef = useRef(null)
  const workerHandlerRef = useRef(null)
  const workerErrorHandlerRef = useRef(null)
  const workerMessageErrorHandlerRef = useRef(null)
  const transcriptionTimeoutRef = useRef(null)

  // WebLLM abort controller – set before each generation, cleared on stop/done
  const webllmAbortRef = useRef(null)

  // WebLLM model loading state
  const [modelLoading, setModelLoading] = useState(true)
  const [modelProgress, setModelProgress] = useState('')
  const [modelProgressPercent, setModelProgressPercent] = useState(0)

  const [selectedModel, setSelectedModel] = useState({ id: 'sonar', name: 'Sonar', icon: Zap })
  const [showModelMenu, setShowModelMenu] = useState(false)
  const modelMenuRef = useRef(null)

  const models = [
    { id: 'sonar', name: 'Sonar', icon: Zap, color: 'text-violet-400' },
    { id: 'gpt-5.4', name: 'GPT-5.4', icon: MessagesSquare, color: 'text-emerald-400' },
    { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', icon: Sparkles, color: 'text-blue-400' },
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', icon: Sun, color: 'text-orange-400' },
    { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', icon: Sun, color: 'text-orange-500' },
    { id: 'nemotron-3-super', name: 'Nemotron 3 Super', icon: Cpu, color: 'text-green-400' },
  ]

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setShowModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const ensureWhisperWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current

    const worker = new Worker(new URL('../lib/whisperWorker.js', import.meta.url), {
      type: 'module'
    })

    const handleWorkerMessage = (e) => {
      const payload = (e && typeof e.data === 'object' && e.data !== null) ? e.data : {}
      const { status, text, data, error } = payload

      if (status === 'progress') {
        if (transcriptionTimeoutRef.current) {
          clearTimeout(transcriptionTimeoutRef.current)
          transcriptionTimeoutRef.current = null
        }
        if (data && (data.status === 'downloading' || data.status === 'init')) {
          setTranscriptionStatus(`Loading AI Model... (${Math.round(data.progress || 0)}%)`)
        }
      } else if (status === 'decoding') {
        if (transcriptionTimeoutRef.current) {
          clearTimeout(transcriptionTimeoutRef.current)
          transcriptionTimeoutRef.current = null
        }
        setTranscriptionStatus('Transcribing audio...')
      } else if (status === 'complete') {
        if (transcriptionTimeoutRef.current) {
          clearTimeout(transcriptionTimeoutRef.current)
          transcriptionTimeoutRef.current = null
        }
        setIsTranscribing(false)
        setTranscriptionStatus('')
        const pre = preListenTextRef.current
        const sep = pre && !pre.endsWith(' ') ? ' ' : ''
        const transcript = typeof text === 'string' ? text.trim() : ''
        if (!transcript) return
        setValue(pre + sep + transcript)
      } else if (status === 'error') {
        if (transcriptionTimeoutRef.current) {
          clearTimeout(transcriptionTimeoutRef.current)
          transcriptionTimeoutRef.current = null
        }
        const normalizedError = (typeof error === 'string' && error.trim())
          ? error
          : (error?.message || String(error || 'Unknown Whisper worker error'))
        if (error && typeof error === 'object') {
          console.error('Whisper worker error:', normalizedError, {
            name: error.name || null,
            stack: error.stack || null,
          })
        } else {
          console.error('Whisper worker error:', normalizedError)
        }
        setIsTranscribing(false)
        setTranscriptionStatus('')
        if (workerRef.current) {
          if (workerHandlerRef.current) {
            workerRef.current.removeEventListener('message', workerHandlerRef.current)
          }
          if (workerErrorHandlerRef.current) {
            workerRef.current.removeEventListener('error', workerErrorHandlerRef.current)
          }
          if (workerMessageErrorHandlerRef.current) {
            workerRef.current.removeEventListener('messageerror', workerMessageErrorHandlerRef.current)
          }
          workerRef.current.terminate()
          workerRef.current = null
          workerHandlerRef.current = null
          workerErrorHandlerRef.current = null
          workerMessageErrorHandlerRef.current = null
        }
      }
    }

    const handleWorkerError = (event) => {
      if (transcriptionTimeoutRef.current) {
        clearTimeout(transcriptionTimeoutRef.current)
        transcriptionTimeoutRef.current = null
      }
      const msg = event?.message || 'Worker crashed during transcription.'
      console.error('Whisper worker runtime error:', msg, event)
      setIsTranscribing(false)
      setTranscriptionStatus('')
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
      workerHandlerRef.current = null
      workerErrorHandlerRef.current = null
      workerMessageErrorHandlerRef.current = null
    }

    const handleWorkerMessageError = (event) => {
      if (transcriptionTimeoutRef.current) {
        clearTimeout(transcriptionTimeoutRef.current)
        transcriptionTimeoutRef.current = null
      }
      console.error('Whisper worker message parse error:', event)
      setIsTranscribing(false)
      setTranscriptionStatus('')
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
      workerHandlerRef.current = null
      workerErrorHandlerRef.current = null
      workerMessageErrorHandlerRef.current = null
    }

    worker.addEventListener('message', handleWorkerMessage)
    worker.addEventListener('error', handleWorkerError)
    worker.addEventListener('messageerror', handleWorkerMessageError)
    workerRef.current = worker
    workerHandlerRef.current = handleWorkerMessage
    workerErrorHandlerRef.current = handleWorkerError
    workerMessageErrorHandlerRef.current = handleWorkerMessageError
    return worker
  }, [])

  // Initialise WebLLM engine (downloads & caches model on first run)
  useEffect(() => {
    initEngine(DEFAULT_MODEL, (report) => {
      const pct = Math.round((report.progress ?? 0) * 100)
      setModelProgressPercent(pct)
      setModelProgress(report.text || `Loading model… ${pct}%`)
    }).then(() => {
      setModelProgressPercent(100)
      setModelLoading(false)
      setModelProgress('')
    }).catch(err => {
      console.error('[WebLLM] Init failed:', err)
      setModelLoading(false)
      setModelProgress('Model failed to load. Check WebGPU support.')
    })
  }, [])

  // Cleanup audio resources only
  const stopAudio = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop())
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close()
    audioContextRef.current = null
    analyserRef.current = null
    mediaStreamRef.current = null
    setAudioLevels(new Array(24).fill(0))
  }, [])

  // Animate waveform from analyser
  const animateWaveform = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(data)
      const bars = 24
      // Human voice is mostly below 8kHz. With fftSize=256 and sampleRate=48kHz, 
      // bin resolution is ~187Hz. 40 bins * 187Hz = 7.5kHz.
      // We take the first 48 bins and map them to 12 bars (since we mirror the other 12).
      const usefulBins = 48
      const sliceSize = Math.floor(usefulBins / (bars / 2))
      const rawLevels = []
      for (let i = 0; i < bars / 2; i++) {
        let sum = 0
        for (let j = 0; j < sliceSize; j++) sum += data[i * sliceSize + j]
        rawLevels.push(sum / sliceSize / 255)
      }

      const levels = new Array(bars).fill(0)
      for (let i = 0; i < bars / 2; i++) {
        // Boost the higher frequencies slightly so edges move more visibly
        const boost = 1 + (i / (bars / 2));
        const val = Math.min(1, rawLevels[i] * boost);
        levels[11 - i] = val; // Mirror left
        levels[12 + i] = val; // Mirror right
      }
      setAudioLevels(levels)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [])

  // Accept: stop recording, encode audio, send to local AI model
  const stopListening = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    stopAudio()
    setIsListening(false)
    setIsTranscribing(true)
    setTranscriptionStatus('Processing audio...')

    // Allow time for the final 'dataavailable' event to fire and chunks to be stored
    setTimeout(async () => {
      if (audioChunksRef.current.length === 0) {
        setIsTranscribing(false)
        setTranscriptionStatus('')
        return
      }

      try {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })

        // Convert to 16kHz Float32Array for Whisper
        const arrayBuffer = await audioBlob.arrayBuffer()
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
        const float32Data = audioBuffer.getChannelData(0)

        // Send to background worker
        const worker = ensureWhisperWorker()
        worker.postMessage({ audio: float32Data })
        if (transcriptionTimeoutRef.current) {
          clearTimeout(transcriptionTimeoutRef.current)
        }
        transcriptionTimeoutRef.current = setTimeout(() => {
          console.error('Whisper transcription timed out waiting for worker response.')
          setIsTranscribing(false)
          setTranscriptionStatus('')
        }, 60000)

      } catch (err) {
        console.error('Audio conversion error:', err)
        setIsTranscribing(false)
        setTranscriptionStatus('')
      }
    }, 100)
  }, [stopAudio, ensureWhisperWorker])

  // Discard: stop recording, delete audio
  const discardListening = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    stopAudio()
    setIsListening(false)
    setIsTranscribing(false)
    setTranscriptionStatus('')
  }, [stopAudio])

  const startListening = useCallback(async () => {
    if (isListening || isTranscribing) return

    preListenTextRef.current = value
    audioChunksRef.current = []

    try {
      ensureWhisperWorker()

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      // Visualizer setup
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioContextRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.7
      source.connect(analyser)
      analyserRef.current = analyser

      // Recording setup
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.start(200) // Collect chunks every 200ms
      setIsListening(true)
      animateWaveform()

    } catch (err) {
      console.error('Mic access denied:', err)
      stopAudio()
    }
  }, [isListening, isTranscribing, value, stopAudio, animateWaveform, ensureWhisperWorker])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop()
      if (transcriptionTimeoutRef.current) {
        clearTimeout(transcriptionTimeoutRef.current)
      }
      if (workerRef.current) {
        if (workerHandlerRef.current) {
          workerRef.current.removeEventListener('message', workerHandlerRef.current)
        }
        if (workerErrorHandlerRef.current) {
          workerRef.current.removeEventListener('error', workerErrorHandlerRef.current)
        }
        if (workerMessageErrorHandlerRef.current) {
          workerRef.current.removeEventListener('messageerror', workerMessageErrorHandlerRef.current)
        }
        workerRef.current.terminate()
      }
      stopAudio()
    }
  }, [stopAudio])

  // Animated Placeholder Logic
  const placeholders = [
    "What's the net worth of Tejas Chauhan...",
    "What's the weather like?",
    "How do I center a div?",
    "Generate a Python script...",
    "Summarize my latest document."
  ];
  const [currentPlaceholder, setCurrentPlaceholder] = useState(0);
  const intervalRef = useRef(null);

  const startAnimation = useCallback(() => {
    intervalRef.current = setInterval(() => {
      setCurrentPlaceholder((prev) => (prev + 1) % placeholders.length);
    }, 10000);
  }, [placeholders.length]);

  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState !== "visible" && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    } else if (document.visibilityState === "visible") {
      startAnimation();
    }
  }, [startAnimation]);

  useEffect(() => {
    startAnimation();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [startAnimation, handleVisibilityChange]);

  // Backend Streaming States
  const [messages, setMessages] = useState([])
  const [queuedMessage, setQueuedMessage] = useState(null)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingReasoningPreview, setStreamingReasoningPreview] = useState('')
  const [status, setStatus] = useState('')
  const [sources, setSources] = useState([])
  const [mode, setMode] = useState('ask') // 'ask' or 'research'
  const [agentRoadmap, setAgentRoadmap] = useState(null)
  const [activeChatId, setActiveChatId] = useState(null)
  const [activeChatTitle, setActiveChatTitle] = useState('New chat')
  const [chatSummary, setChatSummary] = useState('')
  const streamBufferRef = useRef('')

  // ── Turn versioning (edit history per user-message turn) ─────────────────
  // turnVersions: Map<turnIndex, {versions: [{userContent, assistantContent}], currentIdx}>
  const [turnVersions, setTurnVersions] = useState(new Map())
  const [editingTurn, setEditingTurn] = useState(null) // { turnIndex, value }
  const [feedbackMap, setFeedbackMap] = useState(new Map()) // turnIndex -> 'positive' | 'negative'
  const [userProfile, setUserProfile] = useState(null)
  const [speakingTurnIndex, setSpeakingTurnIndex] = useState(null)
  const speakingTurnIndexRef = useRef(null)

  useEffect(() => {
    speakingTurnIndexRef.current = speakingTurnIndex
  }, [speakingTurnIndex])

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const toReadableText = useCallback((text) => {
    if (!text) return ''
    return text
      .replace(/```[\s\S]*?```/g, ' code block omitted. ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/[*_>#~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }, [])

  const speakAssistantMessage = useCallback((turnIndex, rawText) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return
    }

    const synth = window.speechSynthesis

    if (speakingTurnIndexRef.current === turnIndex) {
      synth.cancel()
      setSpeakingTurnIndex(null)
      return
    }

    const text = toReadableText(rawText)
    if (!text) return

    synth.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.pitch = 1

    // Apply selected voice if available
    if (userProfile?.selectedVoice) {
      const voices = synth.getVoices()
      const selected = voices.find(v => v.voiceURI === userProfile.selectedVoice)
      if (selected) {
        utterance.voice = selected
      }
    }

    utterance.onend = () => {
      setSpeakingTurnIndex((current) => (current === turnIndex ? null : current))
    }
    utterance.onerror = () => {
      setSpeakingTurnIndex((current) => (current === turnIndex ? null : current))
    }

    setSpeakingTurnIndex(turnIndex)
    synth.speak(utterance)
  }, [toReadableText, userProfile])

  // Broadcast active chat info to siblings (e.g. ChatArea header) via a window event.
  // This avoids IPC race conditions between siblings.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('scark:activeChatChanged', {
      detail: { chatId: activeChatId, messageCount: messages.length, title: activeChatTitle, isTemporary }
    }))
  }, [messages.length, activeChatId, activeChatTitle, isTemporary])

  // Keep the shared ref up to date so the title-override event handler
  // always compares against the CURRENT activeChatId (avoids stale closure).
  useEffect(() => {
    if (window.__scarkActiveChatIdRef) {
      window.__scarkActiveChatIdRef.current = activeChatId
    }
  }, [activeChatId])

  const commandSuggestions = [
    { icon: <Search className="w-4 h-4" />, label: "Ask", description: "Quick answers with LLM", prefix: "/ask" },
    { icon: <FlaskConical className="w-4 h-4" />, label: "Deep Research", description: "Crawls web for answers", prefix: "/research" },
  ]

  useEffect(() => {
    // Auto-resize the textarea whenever the value changes (which lets it shrink on delete/ctrl+z)
    adjustHeight();
  }, [value])

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files)
      setAttachments(prev => [...prev, ...files])
    }
  }

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }

    if (pastedFiles.length > 0) {
      setAttachments(prev => [...prev, ...pastedFiles]);
    }
  }

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      setAttachments(prev => [...prev, ...files]);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e) => setMousePosition({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])



  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const isAtBottom = scrollHeight - scrollTop <= clientHeight + 150

    if (isAtBottom || (isTyping && streamingContent)) {
      messagesEndRef.current?.scrollIntoView({
        behavior: isTyping ? 'auto' : 'smooth',
        block: 'end'
      })
    }
  }, [messages, streamingContent, isTyping])

  const resetTransientState = useCallback(() => {
    if (webllmAbortRef.current) {
      webllmAbortRef.current.abort()
      webllmAbortRef.current = null
    }
    setQueuedMessage(null)
    setStreamingContent('')
    setStreamingReasoningPreview('')
    setStatus('')
    setSources([])
    setIsTyping(false)
    setValue('')
    setAttachments([])
    setAgentRoadmap(null)
    setFollowUpSuggestions([])
    setFeedbackMap(new Map())
    streamBufferRef.current = ''
  }, [])

  const loadChatSession = useCallback(async (chatId) => {
    resetTransientState()
    if (!chatId || !window.scark?.chat?.get || chatId === 'temp') return
    const session = await window.scark.chat.get(chatId)
    if (!session) return
    if (isTemporary && setIsTemporary) setIsTemporary(false)
    setActiveChatId(session.id)
    setActiveChatTitle(session.title || 'New chat')
    setChatSummary(session.summary || '')
    setMessages((session.messages || []).map(m => ({
      role: m.role,
      content: m.content,
      reasoningPreview: m.reasoningPreview || '',
    })))
    // Load edit history when opening a session
    let loadedVersions = new Map()
    if (session.turnVersionsJson) {
      try {
        const parsed = JSON.parse(session.turnVersionsJson)
        if (Array.isArray(parsed)) {
          loadedVersions = new Map(parsed)
        }
      } catch (e) { }
    }
    setTurnVersions(loadedVersions)
    setFollowUpSuggestions([])
    setEditingTurn(null)
  }, [resetTransientState])

  // Persist turn versions specifically whenever they mutate
  useEffect(() => {
    if (!activeChatId || isTemporary) return
    const str = JSON.stringify(Array.from(turnVersions.entries()))
    window.scark?.chat?.setTurnVersions?.(activeChatId, str).catch(() => { })
  }, [turnVersions, activeChatId, isTemporary])

  const ensureActiveChat = useCallback(async () => {
    if (isTemporary) return { id: 'temp', title: 'Temporary Chat' }
    if (activeChatId) return { id: activeChatId, title: activeChatTitle }
    const created = await window.scark?.chat?.create?.({ title: 'New chat', select: false })
    if (!created?.id) throw new Error('Failed to create chat')
    setActiveChatId(created.id)
    setActiveChatTitle(created.title || 'New chat')
    setChatSummary('')
    return { id: created.id, title: created.title || 'New chat' }
  }, [activeChatId, activeChatTitle, isTemporary])

  const maybeGenerateChatTitle = useCallback(async (chatId, currentTitle, firstUserQuery) => {
    if (!chatId || !firstUserQuery || (currentTitle && currentTitle !== 'New chat') || isTemporary || chatId === 'temp') return
    try {
      const raw = await webllmComplete([
        {
          role: 'system',
          content:
            'You are a helpful assistant that generates extremely concise, catchy, and relevant titles for a new chat session. ' +
            'The title must capture the core intent or topic of the user\'s first message. ' +
            'Rules:\n' +
            '- Maximum 4 to 5 words.\n' +
            '- Do not use quotes, punctuation, or filler words like "How to" or "Question about".\n' +
            '- Capitalize it like a book title (Title Case).\n' +
            '- Output ONLY the title, nothing else.'
        },
        { role: 'user', content: `User's first message:\n"${firstUserQuery}"` },
      ], { maxTokens: 15, temperature: 0.3 })

      const title = (raw || '')
        .split('\n')[0]
        .replace(/["*`]/g, '') // remove any quotes or markdown wrapping
        .trim()
        .slice(0, 45) // keep it reasonably tight

      if (!title) return
      await window.scark?.chat?.rename?.(chatId, title)
      setActiveChatTitle(title)
    } catch (e) {
      console.warn('[Chat] Title generation failed:', e?.message || e)
    }
  }, [])

  const updateRollingSummary = useCallback(async (chatId, userText, assistantText) => {
    if (!chatId || !assistantText || isTemporary || chatId === 'temp') return
    try {
      const nextSummary = await webllmComplete([
        {
          role: 'system',
          content:
            'Maintain a rolling summary for a chat. Keep it under 120 words. ' +
            'Capture goals, key facts, decisions, and open items. Return plain text only.',
        },
        {
          role: 'user',
          content:
            `Current summary:\n${chatSummary || '(none)'}\n\nLatest user message:\n${userText}\n\nLatest assistant message:\n${assistantText}`,
        },
      ], { maxTokens: 170 })

      const summary = (nextSummary || '').trim()
      if (!summary) return
      await window.scark?.chat?.setSummary?.(chatId, summary)
      setChatSummary(summary)
    } catch (e) {
      console.warn('[Chat] Summary update failed:', e?.message || e)
    }
  }, [chatSummary])

  const generateFollowUps = useCallback(async (chatId, userText, assistantText) => {
    if (!chatId || !assistantText || isTemporary || chatId === 'temp') return
    try {
      const raw = await webllmComplete([
        {
          role: 'system',
          content:
            'You are a helpful assistant that generates 3 concise, engaging follow-up questions for a chat conversation. ' +
            'The questions should be relevant to the latest exchange and encourage further exploration. ' +
            'Rules:\n' +
            '- Maximum 6-8 words per question.\n' +
            '- Be specific to the topic discussed.\n' +
            '- Output each question on a new line, starting with a dash "- ".\n' +
            '- Output ONLY the questions, nothing else.'
        },
        {
          role: 'user',
          content: `Latest user message: "${userText}"\nLatest assistant response: "${assistantText.slice(0, 500)}..."`
        },
      ], { maxTokens: 100, temperature: 0.7 })

      const suggestions = (raw || '')
        .split('\n')
        .map(line => line.replace(/^- /, '').trim())
        .filter(line => line.length > 0 && line.length < 100)
        .slice(0, 3)

      setFollowUpSuggestions(suggestions)
    } catch (e) {
      console.warn('[Chat] Follow-up generation failed:', e?.message || e)
    }
  }, [isTemporary])

  // IPC listeners – context status/errors and chat selection updates.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.scark?.chat) return

    const removeError = window.scark.chat.onError((error) => {
      setMessages(msgs => [...msgs, { role: 'assistant', content: `Error retrieving context: ${error || 'Unknown error'}` }])
      setStreamingContent('')
      setStatus('')
      setIsTyping(false)
    })
    const removeStatus = window.scark.chat.onStatus(text => setStatus(text))

    const removeSelected = window.scark.chat.onSelected((chatId) => {
      loadChatSession(chatId)
    })

    // Sync activeChatTitle immediately when ChatArea renames the chat.
    // Uses a ref internally so the event handler always has the current chatId.
    const activeChatIdRef = { current: null }
    const handleTitleOverride = (e) => {
      if (e.detail?.chatId && e.detail.chatId === activeChatIdRef.current) {
        setActiveChatTitle(e.detail.title)
        activeChatIdRef.current = activeChatIdRef.current // keep same id
      }
    }
    // Keep the ref in sync whenever activeChatId changes — done via a nested effect below.
    // We expose a setter so the sibling effect can update it.
    window.__scarkActiveChatIdRef = activeChatIdRef
    window.addEventListener('scark:chatTitleOverride', handleTitleOverride)

    // Ctrl+Shift+O → new chat
    const handleKeyDown = async (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
        e.preventDefault()
        await window.scark?.chat?.create?.({ title: 'New chat', select: true })
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    const init = async () => {
      // Create a fresh chat session on startup as requested
      if (window.scark?.chat?.create) {
        await window.scark.chat.create({ title: 'New chat', select: true })
      }
    }
    init()
    
    // Load profile
    const loadProfile = async () => {
      try {
        const data = await window.scark?.profile?.get?.()
        if (data) setUserProfile(data)
      } catch (e) {}
    }
    loadProfile()

    // Refresh profile when saved (window event)
    const handleProfileSaved = (e) => {
      if (e.detail) setUserProfile(e.detail)
    }
    window.addEventListener('scark:profileSaved', handleProfileSaved)

    return () => {
      removeError()
      removeStatus()
      if (removeSelected) removeSelected()
      window.removeEventListener('scark:chatTitleOverride', handleTitleOverride)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scark:profileSaved', handleProfileSaved)
      delete window.__scarkActiveChatIdRef
    }
  }, [loadChatSession, resetTransientState])

  useEffect(() => {
    if (isTemporary) {
      resetTransientState()
      setActiveChatId(null)
      setActiveChatTitle('Temporary Chat')
      setTurnVersions(new Map())
      setFeedbackMap(new Map())
      setMessages([])
    }
  }, [isTemporary, resetTransientState])

  useEffect(() => {
    if (!isTyping && queuedMessage) {
      const q = queuedMessage;
      setQueuedMessage(null);
      executeSend(q.query, q.modeToUse, messages);
    }
  }, [isTyping, queuedMessage, messages])

  const initializeRoadmap = useCallback((queryMode) => {
    setAgentRoadmap([{ id: 'plan', label: 'Plan actions', status: 'pending', note: '' }])
  }, [])

  const addRoadmapStep = useCallback((step) => {
    setAgentRoadmap(prev => prev ? [...prev, step] : [step])
  }, [])

  const setRoadmapStep = useCallback((stepId, status, note = '', children = undefined) => {
    setAgentRoadmap(prev => {
      if (!prev) return prev
      return prev.map(step => {
        if (step.id === stepId) {
          const updated = { ...step, status, note: note !== '' ? note : step.note }
          if (children !== undefined) updated.children = children
          return updated
        }
        return step
      })
    })
  }, [])

  const updateChildRoadmapStep = useCallback((parentId, childId, status, note = '') => {
    setAgentRoadmap(prev => {
      if (!prev) return prev
      return prev.map(step => {
        if (step.id === parentId && step.children) {
          return {
            ...step,
            children: step.children.map(child =>
              child.id === childId ? { ...child, status, note: note !== '' ? note : child.note } : child
            )
          }
        }
        return step
      })
    })
  }, [])

  const throwIfAborted = useCallback((abortCtrl) => {
    if (abortCtrl?.signal?.aborted) {
      const abortErr = new Error('Aborted')
      abortErr.name = 'AbortError'
      throw abortErr
    }
  }, [])

  const awaitWithAbort = useCallback((promise, abortCtrl, timeoutMs = 12000) => {
    return new Promise((resolve, reject) => {
      let done = false
      const timer = setTimeout(() => {
        if (done) return
        done = true
        const timeoutErr = new Error('Timed out')
        timeoutErr.name = 'TimeoutError'
        reject(timeoutErr)
      }, timeoutMs)

      const onAbort = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        const abortErr = new Error('Aborted')
        abortErr.name = 'AbortError'
        reject(abortErr)
      }

      if (abortCtrl?.signal?.aborted) {
        onAbort()
        return
      }

      abortCtrl?.signal?.addEventListener('abort', onAbort, { once: true })

      Promise.resolve(promise)
        .then(result => {
          if (done) return
          done = true
          clearTimeout(timer)
          abortCtrl?.signal?.removeEventListener('abort', onAbort)
          resolve(result)
        })
        .catch(err => {
          if (done) return
          done = true
          clearTimeout(timer)
          abortCtrl?.signal?.removeEventListener('abort', onAbort)
          reject(err)
        })
    })
  }, [])

  // NOTE: summarizeActions, runPlannedTools, buildAgentSystemPrompt,
  // buildReasoningPreview, and extractSilentChecklist have been moved
  // into renderer/lib/agentLoop.js as part of the dynamic agent refactor.


  const executeSend = async (queryText, queryMode, currentMessages) => {
    let chatId = activeChatId
    let chatTitle = activeChatTitle
    try {
      const ensured = await ensureActiveChat()
      chatId = ensured.id
      chatTitle = ensured.title
    } catch (e) {
      setMessages(msgs => [...msgs, { role: 'assistant', content: 'Error: failed to create chat session.' }])
      return
    }

    const userMsg = { role: 'user', content: queryText }
    const newMessages = [...currentMessages, userMsg]

    setMessages(newMessages)
    setIsTyping(true)
    setStreamingContent('')
    streamBufferRef.current = ''
    setStreamingReasoningPreview('')
    setSources([])
    setFollowUpSuggestions([])
    initializeRoadmap(queryMode)
    adjustHeight(true)

    // Persist user turn immediately.
    try {
      if (!isTemporary && chatId !== 'temp') {
        await window.scark?.chat?.addMessage?.({
          chatId,
          role: 'user',
          content: queryText,
          reasoningPreview: '',
        })
        maybeGenerateChatTitle(chatId, chatTitle, queryText)
      }
    } catch (e) {
      console.warn('[Chat] Failed to persist user message:', e?.message || e)
    }

    // ── Dynamic agent loop ──────────────────────────────────────
    const abortCtrl = new AbortController()
    webllmAbortRef.current = abortCtrl

    const agentCallbacks = {
      initializeRoadmap,
      addRoadmapStep,
      setRoadmapStep,
      updateChildRoadmapStep,
      setStatus,
      setStreamingContent,
      setStreamingReasoningPreview,
      throwIfAborted,
      awaitWithAbort,
    }

    try {
      const result = await runAgentLoop({
        query: queryText,
        mode: queryMode,
        conversationHistory: currentMessages,
        newMessages,
        abortCtrl,
        callbacks: agentCallbacks,
        scark: window.scark,
      })

      // Commit the result as a message
      const finalText = result.finalText
      streamBufferRef.current = ''

      if (finalText) {
        let finalSnapshot = null
        setAgentRoadmap(prev => {
          finalSnapshot = prev
          return prev
        })

        setMessages(msgs => [...msgs, {
          role: 'assistant',
          content: finalText,
          reasoningPreview: result.reasoningPreview || '',
          roadmapSnapshot: finalSnapshot,
        }])
        patchLatestVersionRef.current?.(finalText)

        try {
          if (!isTemporary && chatId !== 'temp') {
            await window.scark?.chat?.addMessage?.({
              chatId,
              role: 'assistant',
              content: finalText,
              reasoningPreview: result.reasoningPreview || '',
              roadmapSnapshot: finalSnapshot ? JSON.stringify(finalSnapshot) : null,
            })
          }
        } catch (e) {
          console.warn('[Chat] Failed to persist assistant message:', e?.message || e)
        }

        updateRollingSummary(chatId, queryText, finalText)
        generateFollowUps(chatId, queryText, finalText)
      }

      if (result.sources?.length > 0) setSources(result.sources)
    } catch (err) {
      const isAbort = abortCtrl.signal.aborted || err?.name === 'AbortError'
      if (!isAbort) {
        const msg = err instanceof Error
          ? err.message
          : (typeof err === 'string' ? err : (err?.message ?? String(err ?? 'Unknown error')))
        console.error('[Chat] Agent loop error:', err)
        setMessages(msgs => [...msgs, { role: 'assistant', content: `Error: ${msg}` }])
      }
    }

    // Cleanup
    setStreamingContent('')
    setStatus('')
    setAgentRoadmap(null)
    setStreamingReasoningPreview('')
    webllmAbortRef.current = null
    setIsTyping(false)
  }

  const handleSendMessage = async (overrideText) => {
    const textToUse = typeof overrideText === 'string' ? overrideText : value
    if (!textToUse.trim()) return

    let currentMode = mode
    let query = textToUse.trim()

    // Check for command prefix execution silently
    if (query.startsWith('/ask')) {
      currentMode = 'ask'
      setMode('ask')
      query = query.replace('/ask', '').trim()
    } else if (query.startsWith('/research')) {
      currentMode = 'research'
      setMode('research')
      query = query.replace('/research', '').trim()
    }

    if (!query) return;

    if (isTyping) {
      setQueuedMessage({ query, modeToUse: currentMode })
      setValue('')
      setFollowUpSuggestions([])
      adjustHeight(true)
      return
    }

    // When sending a fresh message, seed a v1 for this turn (will be finalised after AI responds)
    setValue('')
    setFollowUpSuggestions([])
    await executeSend(query, currentMode, messages)
  }
  
  const [isRefining, setIsRefining] = useState(false)
  const [previousPrompt, setPreviousPrompt] = useState('')

  const handleRefinePrompt = useCallback(async () => {
    if (!value.trim() || isRefining || modelLoading) return
    setIsRefining(true)
    setPreviousPrompt(value)
    try {
      const refined = await webllmComplete([
        {
          role: 'system',
          content: 
            'You are a prompt engineering expert. Your task is to rewrite the user\'s message into a more detailed, clear, and research-optimized version. ' +
            'Focus on making it specific and likely to yield high-quality, comprehensive information. ' +
            'Keep it reasonably concise (under 80 words) but much more descriptive than the original. ' +
            'CRITICAL RULES:\n' +
            '- Output ONLY the refined prompt text.\n' +
            '- DO NOT include any conversational filler, meta-talk, questions, or explanations.\n' +
            '- NEVER say things like "This will help me refine...", "Here is...", or ask "Can you provide more context?".\n' +
            '- If the prompt is vague, use your knowledge to create a comprehensive research-ready prompt based on the most likely interpretation.'
        },
        { role: 'user', content: value.trim() }
      ], { temperature: 0.7, maxTokens: 150 })
      
      if (refined && refined.trim()) {
        let cleaned = refined.trim()
        // Remove common boilerplate patterns if they leak through
        cleaned = cleaned.replace(/This will help me refine the prompt and provide a more accurate and comprehensive response\.?/gi, '')
        cleaned = cleaned.replace(/Here is the( refined)? prompt:?/gi, '')
        cleaned = cleaned.replace(/^Refined Prompt:?/i, '')
        setValue(cleaned.trim())
      }
    } catch (e) {
      console.warn('[Chat] Prompt refinement failed:', e)
    } finally {
      setIsRefining(false)
    }
  }, [value, isRefining, modelLoading])

  // Define a simple wrapper for the UI to use
  const handleSendMessageOverride = (text) => handleSendMessage(text)

  // ── Edit a previous user message ────────────────────────────
  // Groups flat messages array into user+assistant pairs.
  const getGroupedTurns = useCallback((msgs) => {
    const turns = []
    let i = 0
    while (i < msgs.length) {
      if (msgs[i].role === 'user') {
        const userMsg = msgs[i]
        const assistantMsg = msgs[i + 1]?.role === 'assistant' ? msgs[i + 1] : null
        turns.push({ userMsg, assistantMsg, startIndex: i })
        i += assistantMsg ? 2 : 1
      } else {
        i++
      }
    }
    return turns
  }, [])

  const handleEditSubmit = useCallback(async (turnIndex, newText, turns) => {
    if (!newText.trim() || isTyping) return
    setEditingTurn(null)

    const turn = turns[turnIndex]
    // Snapshot the OLD pair into versions before overwriting
    setTurnVersions(prev => {
      const next = new Map(prev)
      const existing = next.get(turnIndex) ?? {
        versions: [{ userContent: turn.userMsg.content, assistantContent: turn.assistantMsg?.content ?? '' }],
        currentIdx: 0,
      }
      // If this is the first edit, ensure v1 is the original
      const newVersion = { userContent: newText.trim(), assistantContent: '' } // placeholder
      return next.set(turnIndex, { versions: [...existing.versions, newVersion], currentIdx: existing.versions.length })
    })

    // Truncate messages to just before this turn, then re-run
    const msgsUpToTurn = messages.slice(0, turn.startIndex)

    // Remove the old completion from the DB so it doesn't duplicate on page reload
    if (activeChatId && !isTemporary && activeChatId !== 'temp') {
      await window.scark?.chat?.truncate?.(activeChatId, turn.startIndex)
    }

    await executeSend(newText.trim(), mode, msgsUpToTurn)
  }, [isTyping, messages, mode, executeSend, activeChatId])

  // After executeSend completes a streamed response, patch the latest version's assistantContent
  const patchLatestVersionRef = useRef(null)
  patchLatestVersionRef.current = (assistantText) => {
    setTurnVersions(prev => {
      if (prev.size === 0) return prev
      const next = new Map()
      let updated = false
      for (const [k, v] of prev) {
        const lastIdx = v.versions.length - 1
        if (!updated && v.versions[lastIdx]?.assistantContent === '') {
          const newVersions = [...v.versions]
          newVersions[lastIdx] = { ...newVersions[lastIdx], assistantContent: assistantText }
          next.set(k, { ...v, versions: newVersions })
          updated = true
        } else {
          next.set(k, v)
        }
      }
      return next
    })
  }

  const navigateTurnVersion = useCallback((turnIndex, delta) => {
    setTurnVersions(prev => {
      const existing = prev.get(turnIndex)
      if (!existing) return prev
      const next = new Map(prev)
      const newIdx = Math.max(0, Math.min(existing.versions.length - 1, existing.currentIdx + delta))
      next.set(turnIndex, { ...existing, currentIdx: newIdx })
      return next
    })
  }, [])

  const handleRegenerate = useCallback(async (turnIndex, turns) => {
    if (isTyping) return
    const turn = turns[turnIndex]
    const userText = turn.userMsg.content

    setTurnVersions(prev => {
      const next = new Map(prev)
      const existing = next.get(turnIndex) ?? {
        versions: [{ userContent: userText, assistantContent: turn.assistantMsg?.content ?? '' }],
        currentIdx: 0,
      }
      const newVersion = { userContent: userText, assistantContent: '' }
      return next.set(turnIndex, {
        versions: [...existing.versions, newVersion],
        currentIdx: existing.versions.length
      })
    })

    const msgsUpToTurn = messages.slice(0, turn.startIndex)
    if (activeChatId && !isTemporary && activeChatId !== 'temp') {
      await window.scark?.chat?.truncate?.(activeChatId, turn.startIndex)
    }
    await executeSend(userText, mode, msgsUpToTurn)
  }, [isTyping, messages, mode, executeSend, activeChatId, isTemporary])

  const handleFeedback = useCallback((turnIndex, isPositive) => {
    if (isPositive) {
      setFeedbackMap(prev => {
        const next = new Map(prev)
        next.set(turnIndex, { type: 'positive' })
        return next
      })
    } else {
      setFeedbackModalTurnIndex(turnIndex)
    }
  }, [])

  const [feedbackModalTurnIndex, setFeedbackModalTurnIndex] = useState(null)

  const handleBranch = useCallback(async (turnIndex, turns) => {
    if (isTyping) return
    const turn = turns[turnIndex]
    const msgsToKeep = messages.slice(0, turn.startIndex + 2) // keep user + assistant messages of this turn

    const newChat = await window.scark?.chat?.create?.({ 
      title: `Branch: ${activeChatTitle.slice(0, 20)}...`,
      select: true 
    })
    
    if (newChat?.id) {
      // Add existing messages to the new chat
      for (const msg of msgsToKeep) {
        await window.scark?.chat?.addMessage?.({
          chatId: newChat.id,
          role: msg.role,
          content: msg.content,
          reasoningPreview: msg.reasoningPreview || '',
          roadmapSnapshot: msg.roadmapSnapshot ? JSON.stringify(msg.roadmapSnapshot) : null
        })
      }
      
      // Select the new chat (handled by onSelected in useEffect)
    }
  }, [isTyping, messages, activeChatTitle])

  const handleStopResponse = async () => {
    if (webllmAbortRef.current) {
      webllmAbortRef.current.abort()
      webllmAbortRef.current = null
    }
    // Commit any partial streamed response once.
    const partial = streamBufferRef.current
    if (partial) {
      streamBufferRef.current = ''
      setMessages(msgs => [...msgs, { role: 'assistant', content: partial, reasoningPreview: streamingReasoningPreview }])
      if (activeChatId && !isTemporary && activeChatId !== 'temp') {
        try {
          await window.scark?.chat?.addMessage?.({
            chatId: activeChatId,
            role: 'assistant',
            content: partial,
            reasoningPreview: streamingReasoningPreview || '',
          })
        } catch (e) {
          console.warn('[Chat] Failed to persist partial response:', e?.message || e)
        }
      }
    }
    setStreamingContent('')
    setAgentRoadmap(null)
    setStreamingReasoningPreview('')
    setStatus('')
    setIsTyping(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    } else if (e.key === 'r' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      setMode(m => m === 'ask' ? 'research' : 'ask')
    } else if (e.key === 'z' && (e.metaKey || e.ctrlKey) && previousPrompt) {
      // Undo prompt refinement
      e.preventDefault()
      setValue(previousPrompt)
      setPreviousPrompt('')
    }
  }

  const shouldShowStarryBg = messages.length === 0

  return (
    <div className="flex flex-col w-full flex-1 min-h-0 bg-transparent dark:bg-black text-foreground relative overflow-hidden rounded-xl">
      <AnimatePresence>
        {shouldShowStarryBg && (
          <motion.div
            key="starry-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: 'easeInOut' }}
            className="absolute inset-0 z-0"
          >
            <StarryIdleBackdrop />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scrollable Messages Area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto w-full scroll-smooth z-10"
        style={{ overflowAnchor: 'auto', overscrollBehaviorY: 'contain' }}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="w-full max-w-5xl mx-auto px-6 py-6 pb-12 space-y-6 flex flex-col min-h-full">
          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4 pt-10">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }} className="inline-block text-center">
                <div className="flex items-center justify-center gap-3 mb-3">
                  <AnimatedLogo mousePosition={mousePosition} className="mb-0 h-10" />
                  <span className="text-2xl font-semibold tracking-[0.28em] text-black/70 dark:text-white/70">SCARK</span>
                </div>
                <h1 className="text-3xl font-medium tracking-tight bg-clip-text text-transparent bg-linear-to-r dark:from-white/90 dark:to-white/40 from-black/90 to-black/40 pb-1">
                  How can I help today?
                </h1>
                <motion.div className="h-px bg-linear-to-r dark:from-transparent dark:via-white/20 dark:to-transparent from-transparent via-black/20 to-transparent my-2" initial={{ width: 0, opacity: 0 }} animate={{ width: "100%", opacity: 1 }} transition={{ delay: 0.5, duration: 0.8 }} />
                <p className="text-sm dark:text-white/40 text-black/40">Type a command or ask a question</p>
              </motion.div>
            </div>
          )}

          {(() => {
            const groupedTurns = getGroupedTurns(messages)
            return groupedTurns.map((turn, turnIndex) => {
              const isLastTurn = turnIndex === groupedTurns.length - 1
              const vEntry = turnVersions.get(turnIndex)
              // What to actually display for this turn
              const displayUserContent = vEntry
                ? vEntry.versions[vEntry.currentIdx].userContent
                : turn.userMsg.content
              const displayAssistantContent = vEntry
                ? vEntry.versions[vEntry.currentIdx].assistantContent || turn.assistantMsg?.content || ''
                : turn.assistantMsg?.content || ''
              const versionCount = vEntry ? vEntry.versions.length : 1
              const currentVersionNum = vEntry ? vEntry.currentIdx + 1 : 1
              const isEditing = editingTurn?.turnIndex === turnIndex
              const assistantTextForReadAloud = vEntry && vEntry.currentIdx < vEntry.versions.length - 1
                ? displayAssistantContent
                : (turn.assistantMsg?.content || '')

              return (
                <React.Fragment key={turnIndex}>
                  {/* USER MESSAGE */}
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                    <div className="max-w-[80%] group relative">
                      {/* Bubble */}
                      {isEditing ? (
                        <div className="flex flex-col gap-2 items-end">
                          <textarea
                            autoFocus
                            value={editingTurn.value}
                            onChange={e => setEditingTurn(prev => ({ ...prev, value: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleEditSubmit(turnIndex, editingTurn.value, groupedTurns)
                              }
                              if (e.key === 'Escape') setEditingTurn(null)
                            }}
                            className="w-80 min-h-[60px] bg-zinc-100 dark:bg-white/10 text-gray-900 dark:text-white text-sm px-4 py-3 rounded-2xl outline-none ring-2 ring-violet-500/40 resize-none"
                            rows={3}
                          />
                          <div className="flex gap-2">
                            <button onClick={() => setEditingTurn(null)} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-white/10 text-gray-600 dark:text-gray-400 hover:bg-zinc-300 dark:hover:bg-white/20 transition-colors">Cancel</button>
                            <button onClick={() => handleEditSubmit(turnIndex, editingTurn.value, groupedTurns)} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors">Send</button>
                          </div>
                        </div>
                      ) : (
                        <div className="px-5 py-3 rounded-2xl whitespace-pre-wrap text-sm leading-snug bg-primary text-primary-foreground dark:bg-white/10 dark:text-white bg-black/5 text-black">
                          {displayUserContent}
                        </div>
                      )}

                      {/* Toolbar: copy, edit, version nav */}
                      {!isEditing && (
                        <div className="flex items-center justify-end gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          {/* Version nav: only if > 1 version */}
                          {versionCount > 1 && (
                            <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                              <button
                                onClick={() => navigateTurnVersion(turnIndex, -1)}
                                disabled={currentVersionNum === 1}
                                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M15 18l-6-6 6-6" /></svg>
                              </button>
                              <span className="font-mono tabular-nums px-1">{currentVersionNum}/{versionCount}</span>
                              <button
                                onClick={() => navigateTurnVersion(turnIndex, 1)}
                                disabled={currentVersionNum === versionCount}
                                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M9 18l6-6-6-6" /></svg>
                              </button>
                            </div>
                          )}
                          {/* Copy */}
                          <button
                            title="Copy message"
                            onClick={() => window.scark?.utils?.copyToClipboard?.(displayUserContent)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                          </button>
                          {/* Edit — only on last turn */}
                          {isLastTurn && !isTyping && (
                            <button
                              title="Edit message"
                              onClick={() => setEditingTurn({ turnIndex, value: turn.userMsg.content })}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>

                  {/* ASSISTANT MESSAGE for this turn */}
                  {(turn.assistantMsg || (isLastTurn && isTyping)) && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
                      <div className="max-w-[80%] group relative dark:text-gray-200 text-gray-800">
                        {/* Show versioned assistant content when navigating, otherwise show real msg */}
                        {vEntry && vEntry.currentIdx < vEntry.versions.length - 1 ? (
                          // Navigated to older version — render with full markdown formatting
                          displayAssistantContent ? (
                            <article
                              className="prose dark:prose-invert max-w-none prose-pre:bg-transparent prose-pre:p-0 prose-headings:my-1 prose-ul:my-0 prose-li:my-0 pb-1 leading-relaxed prose-code:before:content-none prose-code:after:content-none"
                              style={{ fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif', fontSize: '16px' }}
                            >
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkBreaks, remarkExternalLinks]}
                                components={{
                                  code({ node, inline, className, children, ...props }) {
                                    const match = /language-(\w+)/.exec(className || '')
                                    return !inline && match ? (
                                      <CodeBlock language={match[1]} value={String(children).replace(/\n$/, '')} {...props} />
                                    ) : (
                                      <code className={cn("bg-black/10 dark:bg-white/10 px-1 rounded", className)} {...props}>{children}</code>
                                    )
                                  }
                                }}
                              >
                                {displayAssistantContent}
                              </ReactMarkdown>
                            </article>
                          ) : (
                            <span className="text-gray-400 italic text-xs">Response not yet available for this version</span>
                          )
                        ) : turn.assistantMsg ? (
                          <article
                            className="prose dark:prose-invert max-w-none prose-pre:bg-transparent prose-pre:p-0 prose-headings:my-1 prose-ul:my-0 prose-li:my-0 pb-1 leading-relaxed prose-code:before:content-none prose-code:after:content-none"
                            style={{ fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif', fontSize: '16px' }}
                          >
                            {turn.assistantMsg.roadmapSnapshot && (() => {
                              try {
                                const snapshot = typeof turn.assistantMsg.roadmapSnapshot === 'string' 
                                  ? JSON.parse(turn.assistantMsg.roadmapSnapshot) 
                                  : turn.assistantMsg.roadmapSnapshot;
                                return (
                                  <details className="mb-3 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 font-mono">
                                    <summary className="cursor-pointer text-xs font-medium text-foreground/70 select-none font-sans">Agent Roadmap</summary>
                                    <div className="mt-2 text-xs space-y-2">
                                      {snapshot.map((step, idx) => (
                                        <div key={step.id} className="flex items-start gap-2 text-foreground/70">
                                          <span className="w-4 text-center inline-block mt-0.5">
                                            {step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '◉' : step.status === 'failed' ? '✗' : step.status === 'skipped' ? '–' : '○'}
                                          </span>
                                          <div className="flex-1">
                                            <p className={step.status === 'skipped' || step.status === 'pending' ? 'opacity-60' : ''}>{step.label}</p>
                                            {step.note ? <p className="text-[11px] text-foreground/50 whitespace-pre-wrap mt-0.5">{step.note}</p> : null}
                                            {step.children && step.children.length > 0 && (
                                              <div className="mt-1.5 pl-2 border-l border-black/10 dark:border-white/10 space-y-1.5">
                                                {step.children.map(child => (
                                                  <div key={child.id} className="flex items-start gap-2 text-[11px] text-foreground/60">
                                                    <span className="w-4 text-center inline-block">
                                                      {child.status === 'completed' ? '✓' : child.status === 'in_progress' ? '◉' : child.status === 'failed' ? '✗' : child.status === 'skipped' ? '–' : '○'}
                                                    </span>
                                                    <div className="flex-1">
                                                      <p className={child.status === 'skipped' || child.status === 'pending' ? 'opacity-70' : ''}>{child.label}</p>
                                                      {child.note ? <p className="text-[10px] text-foreground/40 whitespace-pre-wrap mt-0.5">{child.note}</p> : null}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )
                              } catch(e) { return null }
                            })()}
                            {turn.assistantMsg.reasoningPreview ? (
                              <details className="mb-3 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 font-sans">
                                <summary className="cursor-pointer text-xs font-medium text-foreground/70 select-none">Reasoning preview</summary>
                                <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/65 font-mono">{turn.assistantMsg.reasoningPreview}</pre>
                              </details>
                            ) : null}
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm, remarkBreaks, remarkExternalLinks]}
                              components={{
                                a({ href, children }) {
                                  const isRawUrl = typeof children?.[0] === 'string' && children[0] === href;
                                  let displayText = children;
                                  let domain = '';
                                  try { const urlObj = new URL(href); domain = urlObj.hostname.replace(/^www\./, ''); } catch (e) { domain = href; }
                                  if (isRawUrl) { displayText = domain + (href.length > domain.length + 8 ? '...' : ''); }
                                  return (
                                    <span className="relative inline-block group mx-1 align-middle">
                                      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-xs font-sans text-gray-700 dark:text-gray-300 no-underline transition-all ring-1 ring-black/5 dark:ring-white/10">
                                        <Globe className="w-3 h-3 opacity-70 shrink-0" />
                                        <span className="truncate max-w-30">{domain}</span>
                                      </a>
                                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-white dark:bg-[#1C1C1C] rounded-xl shadow-xl border border-black/5 dark:border-white/10 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-left font-sans flex flex-col gap-1.5 transform scale-95 group-hover:scale-100 origin-bottom pointer-events-none">
                                        <span className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300"><Globe className="w-3.5 h-3.5 opacity-70 shrink-0" /><span className="truncate">{domain}</span></span>
                                        <span className="text-[13px] font-normal text-gray-600 dark:text-gray-400 line-clamp-3 leading-snug break-all">{href}</span>
                                      </span>
                                    </span>
                                  );
                                },
                                code({ node, inline, className, children, ...props }) {
                                  const match = /language-(\w+)/.exec(className || '')
                                  return !inline && match ? (
                                    <CodeBlock language={match[1]} value={String(children).replace(/\n$/, '')} {...props} />
                                  ) : (
                                    <code className={cn("bg-black/10 dark:bg-white/10 px-1 rounded", className)} {...props}>{children}</code>
                                  )
                                }
                              }}
                            >
                              {turn.assistantMsg.content}
                            </ReactMarkdown>
                          </article>
                        ) : null}
                        {/* Response Action Toolbar */}
                        {turn.assistantMsg && (
                          <div className="flex items-center gap-1.5 mt-2 transition-opacity duration-150">
                            {/* Feedback */}
                            <div className="flex items-center gap-0.5 mr-1">
                              {(feedbackMap.get(turnIndex)?.type === 'positive' || !feedbackMap.get(turnIndex)) && (
                                <button
                                  onClick={() => handleFeedback(turnIndex, true)}
                                  className={cn(
                                    "p-1.5 rounded-lg transition-colors",
                                    feedbackMap.get(turnIndex)?.type === 'positive' 
                                      ? "text-gray-600 dark:text-gray-200 bg-black/5 dark:bg-white/10" 
                                      : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10"
                                  )}
                                  title="Good response"
                                >
                                  <ThumbsUp className={cn("w-3.5 h-3.5", feedbackMap.get(turnIndex)?.type === 'positive' && "fill-current")} />
                                </button>
                              )}
                              {(feedbackMap.get(turnIndex)?.type === 'negative' || !feedbackMap.get(turnIndex)) && (
                                <button
                                  onClick={() => handleFeedback(turnIndex, false)}
                                  className={cn(
                                    "p-1.5 rounded-lg transition-colors",
                                    feedbackMap.get(turnIndex)?.type === 'negative' 
                                      ? "text-gray-600 dark:text-gray-200 bg-black/5 dark:bg-white/10" 
                                      : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10"
                                  )}
                                  title="Bad response"
                                >
                                  <ThumbsDown className={cn("w-3.5 h-3.5", feedbackMap.get(turnIndex)?.type === 'negative' && "fill-current")} />
                                </button>
                              )}
                            </div>

                            <div className="w-px h-3 bg-black/10 dark:bg-white/10 mx-0.5" />

                            <button
                              title="Copy response"
                              onClick={() => window.scark?.utils?.copyToClipboard?.(turn.assistantMsg.content)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                            </button>

                            <button
                              title="Regenerate response"
                              onClick={() => handleRegenerate(turnIndex, groupedTurns)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>

                            <button
                              title={speakingTurnIndex === turnIndex ? 'Stop reading aloud' : 'Read aloud'}
                              onClick={() => speakAssistantMessage(turnIndex, assistantTextForReadAloud)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors"
                            >
                              {speakingTurnIndex === turnIndex ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                            </button>

                            <button
                              onClick={() => handleBranch(turnIndex, groupedTurns)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-violet-500 hover:bg-violet-500/10 transition-colors"
                              title="Branch chat from here"
                            >
                              <GitBranch className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </React.Fragment>
              )
            })
          })()}

          {/* Follow-up Suggestions Chips */}
          {!isTyping && followUpSuggestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-wrap gap-2 justify-start mt-0.5 px-1 pb-4"
            >
              {followUpSuggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessageOverride(suggestion)}
                  className="px-4 py-2 rounded-full border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/15 text-xs font-medium text-foreground/80 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2 group backdrop-blur-sm"
                >
                  <Sparkles className="w-3 h-3 text-violet-500 opacity-70 group-hover:opacity-100" />
                  {suggestion}
                </button>
              ))}
            </motion.div>
          )}

          {/* LLM Thinking/Streaming State in the Main Chat Area (Like Claude/GPT) */}
          {isTyping && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
              <div className="max-w-[80%] px-5 py-3 rounded-2xl dark:text-gray-200 text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">
                {!streamingContent ? (
                  /* Shimmering loader when not streaming tokens yet */
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 h-8">
                      <Sparkles className="w-4 h-4 text-black dark:text-white animate-pulse" />
                      <span
                        className="font-medium tracking-wide bg-clip-text text-transparent bg-size-[200%_auto] animate-shimmer"
                        style={{ backgroundImage: 'linear-gradient(90deg, var(--color-foreground) 0%, gray 50%, var(--color-foreground) 100%)' }}
                      >
                        {status || 'Thinking deeply...'}
                      </span>
                    </div>

                    {agentRoadmap && (
                      <div className="rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-3 text-xs font-mono space-y-1.5">
                        <p className="font-semibold text-foreground/80 mb-1">Roadmap</p>
                        {agentRoadmap.map((step, idx) => (
                          <div key={step.id} className="flex items-start gap-2 text-foreground/70">
                            <span className="w-4 text-center inline-block mt-0.5">
                              {step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '◉' : step.status === 'failed' ? '✗' : step.status === 'skipped' ? '–' : '○'}
                            </span>
                            <div className="flex-1">
                              <p className={step.status === 'skipped' || step.status === 'pending' ? 'opacity-60' : ''}>{step.label}</p>
                              {step.note ? <p className="text-[11px] text-foreground/50 whitespace-pre-wrap mt-0.5">{step.note}</p> : null}
                              {step.children && step.children.length > 0 && (
                                <div className="mt-1.5 pl-2 border-l border-black/10 dark:border-white/10 space-y-1.5">
                                  {step.children.map(child => (
                                    <div key={child.id} className="flex items-start gap-2 text-[11px] text-foreground/60">
                                      <span className="w-4 text-center inline-block">
                                        {child.status === 'completed' ? '✓' : child.status === 'in_progress' ? '◉' : child.status === 'failed' ? '✗' : child.status === 'skipped' ? '–' : '○'}
                                      </span>
                                      <div className="flex-1">
                                        <p className={child.status === 'skipped' || child.status === 'pending' ? 'opacity-70' : ''}>{child.label}</p>
                                        {child.note ? <p className="text-[10px] text-foreground/40 whitespace-pre-wrap mt-0.5">{child.note}</p> : null}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Streaming text view */
                  <div className="space-y-3">
                    {streamingReasoningPreview ? (
                      <details className="rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 font-sans">
                        <summary className="cursor-pointer text-xs font-medium text-foreground/70 select-none">Reasoning preview</summary>
                        <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/65 font-mono">{streamingReasoningPreview}</pre>
                      </details>
                    ) : null}

                    <article
                      className="prose dark:prose-invert max-w-none prose-pre:bg-transparent prose-pre:p-0 prose-headings:my-1 prose-ul:my-0 prose-li:my-0 pb-1 leading-relaxed overflow-hidden"
                      style={{ fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif', fontSize: '16px' }}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks, remarkExternalLinks]}
                        components={{
                          a({ href, children }) {
                            const isRawUrl = typeof children?.[0] === 'string' && children[0] === href;
                            let displayText = children;
                            let domain = '';

                            try {
                              const urlObj = new URL(href);
                              domain = urlObj.hostname.replace(/^www\./, '');
                            } catch (e) {
                              domain = href;
                            }

                            if (isRawUrl) {
                              displayText = domain + (href.length > domain.length + 8 ? '...' : '');
                            }

                            return (
                              <span className="relative inline-block group mx-1 align-middle">
                                <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-xs font-sans text-gray-700 dark:text-gray-300 no-underline transition-all ring-1 ring-black/5 dark:ring-white/10">
                                  <Globe className="w-3 h-3 opacity-70 shrink-0" />
                                  <span className="truncate max-w-30">{domain}</span>
                                </a>

                                {/* Hover Card */}
                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-white dark:bg-[#1C1C1C] rounded-xl shadow-xl border border-black/5 dark:border-white/10 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-left font-sans flex flex-col gap-1.5 transform scale-95 group-hover:scale-100 origin-bottom pointer-events-none">
                                  <span className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                                    <Globe className="w-3.5 h-3.5 opacity-70 shrink-0" />
                                    <span className="truncate">{domain}</span>
                                  </span>
                                  <span className="text-[13px] font-normal text-gray-600 dark:text-gray-400 line-clamp-3 leading-snug break-all">
                                    {href}
                                  </span>
                                </span>
                              </span>
                            );
                          },
                          code({ node, inline, className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '')
                            // Use a simpler static block for streaming content to avoid heavy SyntaxHighlighter stutter/jitter
                            return !inline && match ? (
                              <div className="my-2 rounded-xl overflow-hidden border border-white/5 bg-[#121212] p-4 font-mono text-[0.85rem] whitespace-pre tabular-nums">
                                {children}
                              </div>
                            ) : (
                              <code className={cn("bg-black/10 dark:bg-white/10 px-1 rounded", className)} {...props}>
                                {children}
                              </code>
                            )
                          }
                        }}
                      >
                        {streamingContent + '`▍`'}
                      </ReactMarkdown>
                    </article>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {sources.length > 0 && !isTyping && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
              <div className="max-w-[75%] px-4 py-2 text-xs text-gray-500 space-y-1">
                <p className="font-medium text-gray-400">Sources:</p>
                {sources.map((s, i) => <p key={i} className="truncate">{i + 1}. {s.title || s.url}</p>)}
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} className="h-4 shrink-0" />
        </div>
      </div>

      {/* Input Footer Area */}
      <div className="shrink-0 p-4 max-w-3xl mx-auto w-full z-20 pb-8">

        {/* WebLLM model loading banner – blocks input and shows real progress */}
        <AnimatePresence>
          {modelLoading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="mb-3 px-4 py-3 rounded-xl dark:bg-white/5 bg-black/5 border dark:border-white/5 border-black/5"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium dark:text-white/70 text-black/70 inline-flex items-center gap-1.5">
                  <LoaderIcon className="w-3 h-3 animate-spin shrink-0" />
                  Loading local AI model
                </span>
                <span className="text-xs font-mono tabular-nums dark:text-white/40 text-black/40">
                  {modelProgressPercent}%
                </span>
              </div>
              {/* Progress bar */}
              <div className="w-full h-1 rounded-full overflow-hidden dark:bg-white/10 bg-black/10">
                <motion.div
                  className="h-full bg-violet-500 rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: `${modelProgressPercent}%` }}
                  transition={{ ease: 'linear', duration: 0.25 }}
                />
              </div>
              {modelProgress ? (
                <p className="mt-1.5 text-[10px] leading-tight dark:text-white/30 text-black/30 truncate">
                  {modelProgress}
                </p>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          className={cn(
            "relative backdrop-blur-2xl dark:bg-white/[0.03] bg-black/2 rounded-2xl border transition-colors",
            dragActive ? "dark:border-white/30 border-black/30 dark:bg-white/[0.05] bg-black/5" : "dark:border-white/10 border-black/5"
          )}
          style={{ boxShadow: '0 0 40px -10px rgba(0,0,0,0.5)' }}
          initial={{ scale: 0.98 }}
          animate={{ scale: 1 }}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          {dragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary">
              <div className="flex items-center gap-2 text-primary font-medium">
                <FileUp className="w-5 h-5 animate-bounce" />
                Drop files here
              </div>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="px-4 pt-4 pb-2 flex gap-3 flex-wrap w-full">
              {attachments.map((file, i) => {
                const isImage = file.type.startsWith('image/');
                const objectUrl = isImage ? URL.createObjectURL(file) : null;

                return (
                  <div key={i} className="relative group shrink-0 mt-2">
                    <button
                      onClick={() => removeAttachment(i)}
                      className="absolute -top-2 -left-2 z-10 w-5 h-5 bg-[#212121] border border-white/10 rounded-full flex items-center justify-center text-white/70 hover:text-white transition-colors shadow-sm"
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                    {isImage ? (
                      <div className="w-18 h-18 rounded-xl overflow-hidden shadow-sm">
                        <img src={objectUrl} alt="attachment" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-black/5 dark:bg-white/10 rounded-lg px-3 py-2 h-16 text-xs text-foreground shrink-0 max-w-37.5 border border-zinc-200/50 dark:border-zinc-800 shadow-sm">
                        <FileUp className="w-4 h-4 shrink-0 opacity-70" />
                        <span className="truncate flex-1">{file.name}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="p-4 flex flex-col relative group">
            {/* Only transcription status sits above the input field now */}
            <AnimatePresence>
              {isTranscribing && (
                <motion.div
                  key="transcribing-status"
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden w-full flex"
                >
                  {/* Keep text above textinput on far left margin properly */}
                  <div className="flex items-center gap-2 w-fit bg-black/5 dark:bg-white/10 rounded-full px-4 py-1.5 shadow-sm border border-black/5 dark:border-white/5 mt-1 ml-0.5">
                    <span className="text-xs font-semibold text-foreground/80 whitespace-nowrap">
                      {transcriptionStatus}
                    </span>
                    <TypingDots />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative w-full z-10">
              <Textarea
                ref={textareaRef}
                value={value}
                onChange={e => {
                  setValue(e.target.value)
                  adjustHeight()
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder=""
                containerClassName="w-full relative z-10"
                className="w-full px-4 py-3 resize-none bg-transparent border-none text-foreground text-sm focus:outline-none placeholder:text-muted-foreground min-h-11 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ overflow: "hidden" }}
                showRing={false}
                disabled={modelLoading}
              />

              {/* Overlapping animated placeholder aligned with px-4 py-[12px] padding */}
              <div className="absolute top-0 left-0 right-0 h-11 flex px-4 py-3 pointer-events-none z-0">
                <AnimatePresence mode="wait">
                  {!value && !inputFocused && !isTranscribing && (
                    <motion.p
                      initial={{ y: 5, opacity: 0 }}
                      key={`current-placeholder-${currentPlaceholder}`}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -15, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "linear" }}
                      className="text-sm font-normal text-muted-foreground/70 truncate drop-shadow-sm select-none m-0"
                    >
                      {placeholders[currentPlaceholder]}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Toolbar Inside Input Area */}
          <div className="p-4 pb-3 pt-2 border-t dark:border-white/5 border-black/5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileChange} />
              <button onClick={() => fileInputRef.current?.click()} disabled={modelLoading} className="p-2 text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed" title="Attach file"><Paperclip className="w-4 h-4" /></button>
              {isListening ? (
                <div className="flex items-center gap-1.5">
                  <SoundWave levels={audioLevels} />
                  <button
                    onClick={discardListening}
                    disabled={isTranscribing}
                    className="p-1.5 rounded-full bg-black/5 dark:bg-white/10 text-muted-foreground hover:text-foreground hover:bg-black/10 dark:hover:bg-white/20 transition-colors cursor-pointer disabled:opacity-50"
                    title="Discard"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={stopListening}
                    disabled={isTranscribing}
                    className="p-1.5 rounded-full bg-violet-500/15 text-violet-500 dark:text-violet-300 hover:bg-violet-500/25 transition-colors cursor-pointer disabled:opacity-50"
                    title="Accept"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={startListening}
                  disabled={isTranscribing || modelLoading}
                  className="p-2 rounded-lg transition-all cursor-pointer text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={isTranscribing ? "Transcribing..." : "Voice input"}
                >
                  <Mic className="w-4 h-4" />
                </button>
              )}

              <div className="flex items-center p-0.5 dark:bg-black/20 bg-black/5 rounded-lg border dark:border-white/5 border-black/5 h-8.5 ml-1">
                <button onClick={() => setMode('ask')} className={cn("px-3 h-full rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer", mode === 'ask' ? "bg-white dark:bg-[#333] text-black dark:text-white shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                  <Search className="w-3.5 h-3.5" /> Ask
                </button>
                <div className="w-px h-3 dark:bg-white/10 bg-black/10 mx-0.5" />
                <button onClick={() => setMode('research')} className={cn("px-3 h-full rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer", mode === 'research' ? "bg-white dark:bg-[#333] text-black dark:text-white shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                  <FlaskConical className="w-3.5 h-3.5" /> Deep Research
                </button>
              </div>

              <button
                onClick={handleRefinePrompt}
                disabled={!value.trim() || isRefining || modelLoading}
                className={cn(
                  "p-2 rounded-lg transition-all cursor-pointer flex items-center gap-2",
                  isRefining ? "text-violet-500 animate-pulse bg-violet-500/10" : "text-muted-foreground hover:text-violet-500 hover:bg-violet-500/10",
                  (!value.trim() || modelLoading) && "opacity-40 cursor-not-allowed pointer-events-none"
                )}
                title="Refine Prompt (AI)"
              >
                <Wand2 className={cn("w-4 h-4", isRefining && "text-violet-400")} />
                {isRefining && <span className="text-[10px] font-bold uppercase tracking-widest">Refining...</span>}
              </button>
            </div>

            <div className="flex items-center gap-2 relative" ref={modelMenuRef}>
              <AnimatePresence>
                {showModelMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="absolute bottom-full right-0 mb-3 w-64 bg-black border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 p-1"
                  >
                    <div className="p-1 space-y-0.5">
                      {models.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setSelectedModel(m)
                            setShowModelMenu(false)
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-200 group/item",
                            selectedModel.id === m.id ? "bg-white/10" : "hover:bg-white/5"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <m.icon className={cn("w-4 h-4", m.color || "text-white/60")} />
                            <span className={cn("text-xs font-medium transition-colors", selectedModel.id === m.id ? "text-white" : "text-white/60 group-hover/item:text-white/90")}>
                              {m.name}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                onClick={() => setShowModelMenu(!showModelMenu)}
                className="h-8.5 px-3.5 flex items-center gap-2 rounded-full text-xs font-semibold bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-white/90 shadow-sm"
              >
                <span>{selectedModel.name}</span>
                <ChevronDown className={cn("w-3.5 h-3.5 opacity-60 transition-transform duration-300", showModelMenu ? "rotate-180" : "")} />
              </button>

              <AnimatePresence mode="wait">
                {isTyping && !value.trim() ? (
                  <motion.button
                    key="stop-btn"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={handleStopResponse}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="w-22 h-9 flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all cursor-pointer bg-red-500/10 text-red-500 hover:bg-red-500/20 dark:bg-red-500/15 dark:hover:bg-red-500/25"
                  >
                    <div className="w-2.5 h-2.5 rounded-xs bg-current" />
                    <span>Stop</span>
                  </motion.button>
                ) : (
                  <motion.button
                    key="action-btn"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={handleSendMessage}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={!value.trim() || modelLoading}
                    className={cn(
                      "min-w-22 h-9 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50",
                      value.trim() && !modelLoading
                        ? (isTyping ? "bg-violet-500 text-white shadow-lg hover:bg-violet-600 shadow-violet-500/25" : "dark:bg-white bg-black dark:text-[#0A0A0B] text-white shadow-lg")
                        : "dark:bg-white/5 bg-black/5 text-muted-foreground"
                    )}
                  >
                    {isTyping && value.trim() ? <PlusIcon className="w-4 h-4" /> : <SendIcon className="w-4 h-4" />}
                    <span>{isTyping && value.trim() ? 'Queue' : 'Send'}</span>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

      </div>

      <AnimatePresence>
        {feedbackModalTurnIndex !== null && (
          <FeedbackModal 
            onClose={() => setFeedbackModalTurnIndex(null)}
            onSubmit={(data) => {
              setFeedbackMap(prev => {
                const next = new Map(prev)
                next.set(feedbackModalTurnIndex, { type: 'negative', ...data })
                return next
              })
              setFeedbackModalTurnIndex(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}