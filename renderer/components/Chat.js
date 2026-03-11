'use client'

import React, { useRef, useState, useCallback, useEffect, useTransition } from 'react'
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
  XIcon,
  LoaderIcon,
  Sparkles,
  Command,
  Search,
  FlaskConical,
  Mic,
  Globe
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
import { initEngine, streamChat as webllmStreamChat, complete as webllmComplete, DEFAULT_MODEL, planActions, decideAskPageCap } from '../lib/webllm'

const CodeBlock = React.memo(function CodeBlock({ language, value }) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    navigator.clipboard.writeText(value)
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

export default function Chat() {
  const ASK_ROADMAP = [
    { id: 'plan', label: 'Plan actions', status: 'pending', note: '' },
    { id: 'retrieve', label: 'Retrieve docs', status: 'pending', note: '' },
    { id: 'draft', label: 'Reason draft (x3)', status: 'pending', note: '' },
    { id: 'reflect', label: 'Reflection pass', status: 'pending', note: '' },
    { id: 'final', label: 'Final answer', status: 'pending', note: '' },
  ]

  const RESEARCH_ROADMAP = [
    { id: 'plan', label: 'Plan actions', status: 'pending', note: '' },
    { id: 'retrieve', label: 'Retrieve many docs', status: 'pending', note: '' },
    { id: 'summarize', label: 'Summarize docs', status: 'pending', note: '' },
    { id: 'reason', label: 'Reason (x3)', status: 'pending', note: '' },
    { id: 'reflect', label: 'Reflection pass', status: 'pending', note: '' },
    { id: 'expand', label: 'Expand answer', status: 'pending', note: '' },
  ]

  const [value, setValue] = useState("")
  const [attachments, setAttachments] = useState([])
  const [isTyping, setIsTyping] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
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

  // WebLLM abort controller – set before each generation, cleared on stop/done
  const webllmAbortRef = useRef(null)

  // WebLLM model loading state
  const [modelLoading, setModelLoading] = useState(true)
  const [modelProgress, setModelProgress] = useState('')
  const [modelProgressPercent, setModelProgressPercent] = useState(0)

  // Initialize whisper worker
  useEffect(() => {
    workerRef.current = new Worker(new URL('../lib/whisperWorker.js', import.meta.url), {
      type: 'module'
    })

    workerRef.current.addEventListener('message', (e) => {
      const { status, text, data, error } = e.data

      if (status === 'progress') {
        if (data.status === 'downloading' || data.status === 'init') {
          setTranscriptionStatus(`Loading AI Model... (${Math.round(data.progress || 0)}%)`)
        }
      } else if (status === 'decoding') {
        setTranscriptionStatus('Transcribing audio...')
      } else if (status === 'complete') {
        setIsTranscribing(false)
        setTranscriptionStatus('')
        const pre = preListenTextRef.current
        const sep = pre && !pre.endsWith(' ') ? ' ' : ''
        setValue(pre + sep + text.trim())
      } else if (status === 'error') {
        console.error('Whisper worker error:', error)
        setIsTranscribing(false)
        setTranscriptionStatus('')
      }
    })

    return () => {
      if (workerRef.current) workerRef.current.terminate()
    }
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
        workerRef.current.postMessage({ audio: float32Data })

      } catch (err) {
        console.error('Audio conversion error:', err)
        setIsTranscribing(false)
        setTranscriptionStatus('')
      }
    }, 100)
  }, [stopAudio])

  // Discard: stop recording, delete audio
  const discardListening = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    stopAudio()
    setIsListening(false)
  }, [stopAudio])

  const startListening = useCallback(async () => {
    if (isListening || isTranscribing) return

    preListenTextRef.current = value
    audioChunksRef.current = []

    try {
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
  }, [isListening, isTranscribing, value, stopAudio, animateWaveform])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop()
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

  const commandSuggestions = [
    { icon: <Search className="w-4 h-4" />, label: "Ask", description: "Quick answers with LLM", prefix: "/ask" },
    { icon: <FlaskConical className="w-4 h-4" />, label: "Deep Research", description: "Crawls web for answers", prefix: "/research" },
  ]

  useEffect(() => {
    // Auto-resize the textarea whenever the value changes (which lets it shrink on delete/ctrl+z)
    adjustHeight();
  }, [value, adjustHeight])

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
    streamBufferRef.current = ''
  }, [])

  const loadChatSession = useCallback(async (chatId) => {
    if (!chatId || !window.scark?.chat?.get) return
    const session = await window.scark.chat.get(chatId)
    if (!session) return

    resetTransientState()
    setActiveChatId(session.id)
    setActiveChatTitle(session.title || 'New chat')
    setChatSummary(session.summary || '')
    setMessages((session.messages || []).map(m => ({
      role: m.role,
      content: m.content,
      reasoningPreview: m.reasoningPreview || '',
    })))
  }, [resetTransientState])

  const ensureActiveChat = useCallback(async () => {
    if (activeChatId) return { id: activeChatId, title: activeChatTitle }
    const created = await window.scark?.chat?.create?.({ title: 'New chat', select: false })
    if (!created?.id) throw new Error('Failed to create chat')
    setActiveChatId(created.id)
    setActiveChatTitle(created.title || 'New chat')
    setChatSummary('')
    return { id: created.id, title: created.title || 'New chat' }
  }, [activeChatId, activeChatTitle])

  const maybeGenerateChatTitle = useCallback(async (chatId, currentTitle, firstUserQuery) => {
    if (!chatId || !firstUserQuery || (currentTitle && currentTitle !== 'New chat')) return
    try {
      const raw = await webllmComplete([
        {
          role: 'system',
          content:
            'Generate a concise chat title based on the user query. ' +
            'Return only the title, 3-7 words, no quotes, no markdown, no trailing punctuation.',
        },
        { role: 'user', content: firstUserQuery },
      ], { maxTokens: 20 })

      const title = (raw || '')
        .split('\n')[0]
        .replace(/^"|"$/g, '')
        .trim()
        .slice(0, 80)

      if (!title) return
      await window.scark?.chat?.rename?.(chatId, title)
      setActiveChatTitle(title)
    } catch (e) {
      console.warn('[Chat] Title generation failed:', e?.message || e)
    }
  }, [])

  const updateRollingSummary = useCallback(async (chatId, userText, assistantText) => {
    if (!chatId || !assistantText) return
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

    const init = async () => {
      const chats = await window.scark.chat.list()
      if ((chats ?? []).length > 0) {
        const first = chats[0].id
        await loadChatSession(first)
        window.scark.chat.select(first)
      }
    }
    init()

    return () => { removeError(); removeStatus(); if (removeSelected) removeSelected() }
  }, [loadChatSession, resetTransientState])

  useEffect(() => {
    if (!isTyping && queuedMessage) {
      const q = queuedMessage;
      setQueuedMessage(null);
      executeSend(q.query, q.modeToUse, messages);
    }
  }, [isTyping, queuedMessage, messages])

  const initializeRoadmap = useCallback((queryMode) => {
    const base = queryMode === 'research' ? RESEARCH_ROADMAP : ASK_ROADMAP
    setAgentRoadmap(base.map(step => ({ ...step })))
  }, [ASK_ROADMAP, RESEARCH_ROADMAP])

  const setRoadmapStep = useCallback((stepId, status, note = '') => {
    setAgentRoadmap(prev => {
      if (!prev) return prev
      return prev.map(step => step.id === stepId ? { ...step, status, note: note || step.note } : step)
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

  const summarizeActions = useCallback((actions) => {
    if (!actions.length) return 'No external tools needed'
    return actions.map((a, idx) => {
      const arg = a.args?.query || a.args?.url || ''
      return `${idx + 1}. ${a.tool}${arg ? ` -> ${arg}` : ''}`
    }).join('\n')
  }, [])

  const runPlannedTools = useCallback(async (actions, queryMode, abortCtrl, askPageCap = 2) => {
    const gathered = []
    const maxActions = queryMode === 'research' ? 6 : 3
    const cappedActions = actions.slice(0, maxActions)

    // Ask mode prioritizes responsiveness over exhaustive retrieval.
    const normalizedActions = queryMode === 'ask'
      ? cappedActions.filter((a, idx) => {
          if (a.tool !== 'web_search') return true
          const firstWebIdx = cappedActions.findIndex(x => x.tool === 'web_search')
          return idx === firstWebIdx
        })
      : cappedActions

    for (let i = 0; i < normalizedActions.length; i++) {
      const action = normalizedActions[i]
      throwIfAborted(abortCtrl)
      setStatus(`Retrieving docs (${i + 1}/${normalizedActions.length})...`)
      try {
        if (action.tool === 'web_search' && window.scark?.query?.websearch) {
          const pages = queryMode === 'research' ? 5 : askPageCap
          const timeout = queryMode === 'research' ? 22000 : 9000
          const hits = await awaitWithAbort(window.scark.query.websearch(action.args.query, pages), abortCtrl, timeout)
          for (const h of (hits ?? [])) {
            gathered.push({ type: 'web', title: h.title, url: h.url, text: h.text })
          }
        }

        if (action.tool === 'read_url' && window.scark?.query?.fetchUrl) {
          const timeout = queryMode === 'research' ? 18000 : 8000
          const page = await awaitWithAbort(window.scark.query.fetchUrl(action.args.url), abortCtrl, timeout)
          if (page?.text) {
            gathered.push({ type: 'url', title: page.title || action.args.url, url: action.args.url, text: page.text })
          }
        }

        if (action.tool === 'knowledge_search' && window.scark?.chat?.getContext) {
          const kbCtx = await awaitWithAbort(window.scark.chat.getContext({
            messages: [{ role: 'user', content: action.args.query }],
            topK: queryMode === 'research' ? 8 : 5,
            mode: 'ask',
          }), abortCtrl, queryMode === 'research' ? 12000 : 7000).catch(() => null)

          if (kbCtx?.success) {
            for (const s of (kbCtx.sources ?? [])) {
              gathered.push({ type: 'knowledge', title: s.title, url: s.url, text: '' })
            }
            if (kbCtx.systemPrompt) {
              gathered.push({ type: 'knowledge_prompt', title: 'Knowledge context', url: '', text: kbCtx.systemPrompt })
            }
          }
        }
      } catch (e) {
        if (e?.name === 'AbortError') throw e
        console.warn(`[Agent] Tool ${action.tool} failed:`, e?.message || e)
      }
    }

    const seen = new Set()
    return gathered.filter(r => {
      const key = r.url || `${r.type}:${r.title}`
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [awaitWithAbort, throwIfAborted])

  const buildAgentSystemPrompt = useCallback((queryMode, docs, fallbackPrompt) => {
    const knowledgePrompt = docs.find(d => d.type === 'knowledge_prompt')?.text
    const docItems = docs.filter(d => d.type !== 'knowledge_prompt' && d.text)

    const charBudget = queryMode === 'research' ? 12000 : 7000
    let used = 0
    let contextText = ''
    const usedDocs = []

    for (let i = 0; i < docItems.length; i++) {
      const d = docItems[i]
      const entry = `[${usedDocs.length + 1}] ${d.title || d.url}\n${d.text}\n\n`
      if (used + entry.length > charBudget && usedDocs.length > 0) break
      used += entry.length
      usedDocs.push(d)
      contextText += entry
    }

    const basePrompt = knowledgePrompt || fallbackPrompt || 'You are a helpful assistant.'
    const modeInstruction = queryMode === 'research'
      ? 'Use evidence from sources, synthesize across documents, and call out uncertainty briefly when sources conflict.'
      : 'Use evidence from sources when available and keep the answer direct.'

    return {
      systemPrompt: `${basePrompt}\n\n${modeInstruction}\n${contextText ? `\nReference material:\n${contextText}` : ''}`,
      sources: usedDocs.map(d => ({ title: d.title, url: d.url })),
      docDigest: usedDocs.map((d, i) => `[${i + 1}] ${d.title || d.url}`).join('\n')
    }
  }, [])

  const buildReasoningPreview = useCallback((queryMode, actions, sourceCount, reflectionNotes) => {
    const modeLabel = queryMode === 'research' ? 'Deep Research' : 'Ask'
    const actionLines = actions.length
      ? actions.map((a, idx) => {
          const arg = a.args?.query || a.args?.url || ''
          return `${idx + 1}. ${a.tool}${arg ? ` -> ${arg}` : ''}`
        }).join('\n')
      : '1. none'

    const reflectionExcerpt = (reflectionNotes || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 360)

    return [
      `Mode: ${modeLabel}`,
      '',
      'Plan:',
      actionLines,
      '',
      `Retrieved sources: ${sourceCount}`,
      queryMode === 'research' ? 'Pipeline: retrieve docs -> summarize -> reason x3 -> reflect -> expand' : 'Pipeline: retrieve docs -> reason x3 -> reflect -> final',
      reflectionExcerpt ? `Reflection preview: ${reflectionExcerpt}${reflectionNotes.length > 360 ? ' ...' : ''}` : 'Reflection preview: pending',
    ].join('\n')
  }, [])

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
    initializeRoadmap(queryMode)
    adjustHeight(true)

    // Persist user turn immediately.
    try {
      await window.scark?.chat?.addMessage?.({
        chatId,
        role: 'user',
        content: queryText,
        reasoningPreview: '',
      })
      maybeGenerateChatTitle(chatId, chatTitle, queryText)
    } catch (e) {
      console.warn('[Chat] Failed to persist user message:', e?.message || e)
    }

    // 1. Agentic planning + retrieval
    const abortCtrl = new AbortController()
    webllmAbortRef.current = abortCtrl
    let context = null

    let plannedActions = []
    let askPageCap = 2

    try {
      setRoadmapStep('plan', 'in_progress')
      setStatus('Planning actions...')
      const { actions } = await planActions(queryText, queryMode)
      plannedActions = actions
      throwIfAborted(abortCtrl)

      if (queryMode === 'ask') {
        askPageCap = await decideAskPageCap(queryText)
        throwIfAborted(abortCtrl)
      }

      const planNote = queryMode === 'ask'
        ? `${summarizeActions(actions)}\nask page cap: ${askPageCap}`
        : summarizeActions(actions)
      setRoadmapStep('plan', 'completed', planNote)

      const retrieveStepId = queryMode === 'research' ? 'retrieve' : 'retrieve'
      setRoadmapStep(retrieveStepId, 'in_progress')
      setStatus(queryMode === 'research' ? 'Retrieving many docs...' : `Retrieving docs (cap ${askPageCap} page${askPageCap > 1 ? 's' : ''})...`)

      const fallbackCtx = await awaitWithAbort(window.scark?.chat?.getContext({
        messages: newMessages,
        topK: queryMode === 'research' ? 8 : 5,
        mode: queryMode,
      }), abortCtrl, queryMode === 'research' ? 12000 : 7000).catch(() => null)

      const plannedDocs = await runPlannedTools(actions, queryMode, abortCtrl, askPageCap)
      throwIfAborted(abortCtrl)

      const fallbackPrompt = fallbackCtx?.success ? fallbackCtx.systemPrompt : ''
      const mergedSources = [
        ...(plannedDocs ?? []),
        ...((fallbackCtx?.sources ?? []).map(s => ({ type: 'knowledge', title: s.title, url: s.url, text: '' }))),
      ]

      const built = buildAgentSystemPrompt(queryMode, mergedSources, fallbackPrompt)
      context = { success: true, systemPrompt: built.systemPrompt, sources: built.sources, docDigest: built.docDigest }

      setRoadmapStep(retrieveStepId, 'completed', `${context.sources.length} source(s) gathered`)
      setStreamingReasoningPreview(buildReasoningPreview(queryMode, plannedActions, context.sources.length, ''))

      if (queryMode === 'research') {
        setRoadmapStep('summarize', 'in_progress')
        setStatus('Summarizing gathered docs...')
        const summary = await webllmComplete([
          { role: 'system', content: 'Summarize evidence for downstream reasoning. Return concise bullet points with [source] style references when possible.' },
          { role: 'user', content: `Question: ${queryText}\n\nSources:\n${context.docDigest || 'No source digest available.'}` },
        ], { maxTokens: 280 })
        throwIfAborted(abortCtrl)
        context.systemPrompt = `${context.systemPrompt}\n\nResearch summary:\n${summary}`
        setRoadmapStep('summarize', 'completed', 'Evidence summary prepared')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err?.message ?? 'Unknown error')
      const isAbort = abortCtrl.signal.aborted || err?.name === 'AbortError'
      if (!isAbort) setMessages(msgs => [...msgs, { role: 'assistant', content: `Error retrieving context: ${msg}` }])
      setStatus('')
      setIsTyping(false)
      setAgentRoadmap(null)
      webllmAbortRef.current = null
      return
    }

    // 2. Multi-draft reasoning + reflection
    const reasoningStep = queryMode === 'research' ? 'reason' : 'draft'
    setRoadmapStep(reasoningStep, 'in_progress')
    setStatus(queryMode === 'research' ? 'Running reasoning passes...' : 'Drafting candidate answers...')

    let reflectionGuidance = ''
    try {
      const promptBase = [
        { role: 'system', content: `${context.systemPrompt}\n\nDo not reveal chain-of-thought. Return only final answer text for this draft.` },
        ...newMessages,
      ]

      const [draft1, draft2, draft3] = await Promise.all([
        webllmComplete([...promptBase, { role: 'user', content: 'Draft style: concise and factual. Keep it short.' }], { maxTokens: queryMode === 'research' ? 380 : 240 }),
        webllmComplete([...promptBase, { role: 'user', content: 'Draft style: analytical with explicit source grounding.' }], { maxTokens: queryMode === 'research' ? 420 : 260 }),
        webllmComplete([...promptBase, { role: 'user', content: 'Draft style: practical, action-oriented, and easy to follow.' }], { maxTokens: queryMode === 'research' ? 420 : 260 }),
      ])

      throwIfAborted(abortCtrl)
      setRoadmapStep(reasoningStep, 'completed', '3 candidate drafts generated')

      setRoadmapStep('reflect', 'in_progress')
      setStatus('Running reflection pass...')

      reflectionGuidance = await webllmComplete([
        {
          role: 'system',
          content:
            'You are a reflection model. Compare 3 candidate answers and select the strongest one. ' +
            'Return:\n1) Best draft number\n2) Why it is best (short)\n3) Improvement checklist (3-5 bullets).\n' +
            'Do not include chain-of-thought.',
        },
        {
          role: 'user',
          content:
            `Question: ${queryText}\n\nDraft 1:\n${draft1}\n\nDraft 2:\n${draft2}\n\nDraft 3:\n${draft3}`,
        },
      ], { maxTokens: 260 })

      throwIfAborted(abortCtrl)
      setRoadmapStep('reflect', 'completed', 'Best draft selected with improvements')
      setStreamingReasoningPreview(buildReasoningPreview(queryMode, plannedActions, context?.sources?.length || 0, reflectionGuidance))
    } catch (err) {
      const isAbort = abortCtrl.signal.aborted || err?.name === 'AbortError'
      if (!isAbort) {
        setMessages(msgs => [...msgs, { role: 'assistant', content: `Error during reasoning: ${err?.message || 'Unknown error'}` }])
      }
      setStatus('')
      setIsTyping(false)
      setAgentRoadmap(null)
      setStreamingReasoningPreview('')
      webllmAbortRef.current = null
      return
    }

    // 3. Build full message list including retrieved system prompt
    const fullMessages = context
      ? [{ role: 'system', content: context.systemPrompt }, ...newMessages]
      : newMessages

    const finalStep = queryMode === 'research' ? 'expand' : 'final'
    setRoadmapStep(finalStep, 'in_progress')
    setStatus(queryMode === 'research' ? 'Expanding final answer...' : 'Composing final answer...')

    try {
      const finalInstruction = queryMode === 'research'
        ? 'Using the reflection notes, produce a structured deep-research answer: executive summary, key findings, evidence-backed analysis, and clear next steps.'
        : 'Using the reflection notes, produce the best single final answer. Keep it concise and useful.'

      const guidedMessages = [
        ...fullMessages,
        {
          role: 'user',
          content: `${finalInstruction}\n\nReflection notes:\n${reflectionGuidance}`,
        },
      ]

      for await (const token of webllmStreamChat(guidedMessages, { signal: abortCtrl.signal })) {
        streamBufferRef.current += token
        setStreamingContent(streamBufferRef.current)
      }
    } catch (err) {
      const isAbort = abortCtrl.signal.aborted || err?.name === 'AbortError'
      if (!isAbort) {
        const msg = err instanceof Error
          ? err.message
          : (typeof err === 'string' ? err : (err?.message ?? JSON.stringify(err)))
        setMessages(msgs => [...msgs, { role: 'assistant', content: `Error: ${msg || 'Unknown inference error'}` }])
        streamBufferRef.current = ''
        setStreamingContent('')
        setIsTyping(false)
        setAgentRoadmap(null)
        setStreamingReasoningPreview('')
        return
      }
    }

    // 4. Commit streamed tokens as a message
    const finalText = streamBufferRef.current
    if (finalText) {
      streamBufferRef.current = ''
      setMessages(msgs => [...msgs, { role: 'assistant', content: finalText, reasoningPreview: streamingReasoningPreview }])

      try {
        await window.scark?.chat?.addMessage?.({
          chatId,
          role: 'assistant',
          content: finalText,
          reasoningPreview: streamingReasoningPreview || '',
        })
      } catch (e) {
        console.warn('[Chat] Failed to persist assistant message:', e?.message || e)
      }

      updateRollingSummary(chatId, queryText, finalText)
    }
    setStreamingContent('')
    setRoadmapStep(finalStep, 'completed', 'Response generated')
    if (context?.sources?.length > 0) setSources(context.sources)
    setStatus('')
    setAgentRoadmap(null)
    setStreamingReasoningPreview('')
    webllmAbortRef.current = null
    setIsTyping(false)
  }

  const handleSendMessage = async () => {
    if (!value.trim()) return

    let currentMode = mode
    let query = value.trim()

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
      adjustHeight(true)
      return
    }

    setValue('')
    await executeSend(query, currentMode, messages)
  }

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
      if (activeChatId) {
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
    }
  }

  return (
    <div className="flex flex-col w-full flex-1 min-h-0 bg-transparent text-foreground relative overflow-hidden rounded-xl">

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
              <h1 className="text-3xl font-medium tracking-tight bg-clip-text text-transparent bg-linear-to-r dark:from-white/90 dark:to-white/40 from-black/90 to-black/40 pb-1">
                How can I help today?
              </h1>
              <motion.div className="h-px bg-linear-to-r dark:from-transparent dark:via-white/20 dark:to-transparent from-transparent via-black/20 to-transparent my-2" initial={{ width: 0, opacity: 0 }} animate={{ width: "100%", opacity: 1 }} transition={{ delay: 0.5, duration: 0.8 }} />
              <p className="text-sm dark:text-white/40 text-black/40">Type a command or ask a question</p>
            </motion.div>
          </div>
        )}

        {messages.map((msg, i) => (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-5 py-3 rounded-2xl whitespace-pre-wrap text-sm leading-snug ${msg.role === 'user'
              ? 'bg-primary text-primary-foreground dark:bg-white/10 dark:text-white bg-black/5 text-black'
              : 'dark:text-gray-200 text-gray-800'
              }`}>
              {msg.role === 'user' ? (
                msg.content
              ) : (
                <article 
                  className="prose dark:prose-invert max-w-none prose-p:my-0 prose-pre:bg-transparent prose-pre:p-0 prose-headings:my-1 prose-ul:my-0 prose-li:my-0 pb-1 leading-snug"
                  style={{ fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif', fontSize: '16px' }}
                >
                  {msg.reasoningPreview ? (
                    <details className="mb-3 rounded-lg border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 font-sans">
                      <summary className="cursor-pointer text-xs font-medium text-foreground/70 select-none">Reasoning preview</summary>
                      <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/65 font-mono">{msg.reasoningPreview}</pre>
                    </details>
                  ) : null}
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
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-white dark:bg-[#1C1C1C] rounded-xl shadow-xl border border-black/5 dark:border-white/10 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-left font-sans flex flex-col gap-1.5 transform scale-95 group-hover:scale-100 origin-bottom pointer-events-none">
                               <div className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                                  <Globe className="w-3.5 h-3.5 opacity-70 shrink-0" />
                                  <span className="truncate">{domain}</span>
                               </div>
                               <div className="text-[13px] font-normal text-gray-600 dark:text-gray-400 line-clamp-3 leading-snug break-all">
                                  {href}
                               </div>
                            </div>
                          </span>
                        );
                      },
                      code({ node, inline, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '')
                        return !inline && match ? (
                          <CodeBlock
                            language={match[1]}
                            value={String(children).replace(/\n$/, '')}
                            {...props}
                          />
                        ) : (
                          <code className={cn("bg-black/10 dark:bg-white/10 px-1 rounded", className)} {...props}>
                            {children}
                          </code>
                        )
                      }
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </article>
              )}
            </div>
          </motion.div>
        ))}

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
                          <span className="w-4 inline-block">{step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '>' : '-'}</span>
                          <div className="flex-1">
                            <p>{idx + 1}. {step.label}</p>
                            {step.note ? <p className="text-[11px] text-foreground/50 whitespace-pre-wrap">{step.note}</p> : null}
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
                    className="prose dark:prose-invert max-w-none prose-p:my-0 prose-pre:bg-transparent prose-pre:p-0 prose-headings:my-1 prose-ul:my-0 prose-li:my-0 pb-1 leading-snug overflow-hidden"
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
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-white dark:bg-[#1C1C1C] rounded-xl shadow-xl border border-black/5 dark:border-white/10 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-left font-sans flex flex-col gap-1.5 transform scale-95 group-hover:scale-100 origin-bottom pointer-events-none">
                                 <div className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                                    <Globe className="w-3.5 h-3.5 opacity-70 shrink-0" />
                                    <span className="truncate">{domain}</span>
                                 </div>
                                 <div className="text-[13px] font-normal text-gray-600 dark:text-gray-400 line-clamp-3 leading-snug break-all">
                                    {href}
                                 </div>
                              </div>
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
            "relative backdrop-blur-2xl dark:bg-white/2 bg-black/2 rounded-2xl border shadow-2xl transition-colors",
            dragActive ? "dark:border-white/30 border-black/30 dark:bg-white/5 bg-black/5" : "dark:border-white/5 border-black/5"
          )}
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
                onChange={e => { setValue(e.target.value); adjustHeight() }}
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
            </div>

            <div className="flex items-center gap-2 relative">
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
    </div>
  )
}