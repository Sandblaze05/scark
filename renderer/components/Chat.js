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
  FlaskConical
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

export default function Chat() {
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
  const [streamingContent, setStreamingContent] = useState('')
  const [status, setStatus] = useState('')
  const [sources, setSources] = useState([])
  const [mode, setMode] = useState('ask') // 'ask' or 'research'

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

  // IPC Streaming Listeners
  useEffect(() => {
    if (typeof window === 'undefined' || !window.scark?.chat) return

    const removeToken = window.scark.chat.onToken((token) => setStreamingContent(prev => prev + token))
    const removeDone = window.scark.chat.onDone(() => {
      setStreamingContent(prev => {
        if (prev) setMessages(msgs => [...msgs, { role: 'assistant', content: prev }])
        return ''
      })
      setIsTyping(false)
    })
    const removeError = window.scark.chat.onError((error) => {
      setMessages(msgs => [...msgs, { role: 'assistant', content: `Error: ${error}` }])
      setStreamingContent('')
      setStatus('')
      setIsTyping(false)
    })
    const removeStatus = window.scark.chat.onStatus(text => setStatus(text))

    return () => { removeToken(); removeDone(); removeError(); removeStatus() }
  }, [])

  const handleSendMessage = async () => {
    if (!value.trim() || isTyping) return

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

    const userMsg = { role: 'user', content: query }
    const newMessages = [...messages, userMsg]

    setMessages(newMessages)
    setValue('')
    setIsTyping(true)
    setStreamingContent('')
    setSources([])
    adjustHeight(true)

    try {
      if (window.scark?.chat) {
        const result = await window.scark.chat.send({ messages: newMessages, topK: 5, mode: currentMode })
        if (result?.sources?.length > 0) setSources(result.sources)
      } else {
        // Mock delay if backend absent
        setTimeout(() => setIsTyping(false), 2000)
      }
    } catch (err) {
      setMessages(msgs => [...msgs, { role: 'assistant', content: `Error: ${err.message}` }])
      setIsTyping(false)
    }
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
        className="flex-1 overflow-y-auto px-6 py-6 space-y-6 scroll-smooth z-10 w-full max-w-4xl mx-auto flex flex-col"
        style={{ overflowAnchor: 'auto', overscrollBehaviorY: 'contain' }}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
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
            <div className={`max-w-[80%] px-5 py-3 rounded-2xl whitespace-pre-wrap text-sm leading-relaxed ${msg.role === 'user'
              ? 'bg-primary text-primary-foreground dark:bg-white/10 dark:text-white bg-black/5 text-black'
              : 'dark:text-gray-200 text-gray-800'
              }`}>
              {msg.role === 'user' ? (
                msg.content
              ) : (
                <article className="prose prose-sm dark:prose-invert max-w-none prose-p:my-0 prose-pre:bg-transparent prose-pre:p-0 prose-headings:my-1 prose-ul:my-0 prose-li:my-0 pb-1 leading-normal">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks, remarkExternalLinks]}
                    components={{
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

        {isTyping && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] px-5 py-3 rounded-2xl dark:text-gray-200 text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">
              <article className="prose prose-sm dark:prose-invert max-w-none prose-p:my-0 prose-headings:my-1 prose-ul:my-0 prose-li:my-0 pb-1 leading-normal overflow-hidden">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkBreaks, remarkExternalLinks]}
                  components={{
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
          </div>
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

      {/* Input Footer Area */}
      <div className="shrink-0 p-4 max-w-3xl mx-auto w-full z-20 pb-8">
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
                      <div className="w-[72px] h-[72px] rounded-xl overflow-hidden shadow-sm">
                        <img src={objectUrl} alt="attachment" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-black/5 dark:bg-white/10 rounded-lg px-3 py-2 h-16 text-xs text-foreground shrink-0 max-w-[150px] border border-zinc-200/50 dark:border-zinc-800 shadow-sm">
                        <FileUp className="w-4 h-4 shrink-0 opacity-70" />
                        <span className="truncate flex-1">{file.name}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="p-4 relative group">
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
              className="w-full px-4 py-[12px] resize-none bg-transparent border-none text-foreground text-sm focus:outline-none placeholder:text-muted-foreground min-h-[44px]"
              style={{ overflow: "hidden" }}
              showRing={false}
            />

            {/* Overlapping animated placeholder perfectly aligned with px-4 py-[12px] padding */}
            <div className={`absolute top-4 left-4 right-4 h-[44px] flex px-4 py-[12px] pointer-events-none z-0`}>
              <AnimatePresence mode="wait">
                {isTyping && !streamingContent ? (
                  <motion.div
                    key="thinking-status"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-center gap-2 -mt-1 -ml-2 bg-black/5 dark:bg-white/10 rounded-full px-4 py-1.5 shadow-sm border border-black/5 dark:border-white/5"
                  >
                    <span className="text-xs font-semibold text-foreground/80">
                      {status || 'Thinking'}
                    </span>
                    <TypingDots />
                  </motion.div>
                ) : (
                  (!value && !inputFocused) && (
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
                  )
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Toolbar Inside Input Area */}
          <div className="p-4 pb-3 pt-2 border-t dark:border-white/5 border-black/5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <input type="file" multiple ref={fileInputRef} className="hidden" onChange={handleFileChange} />
              <button onClick={() => fileInputRef.current?.click()} className="p-2 text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" title="Attach file"><Paperclip className="w-4 h-4" /></button>

              <div className="flex items-center p-0.5 dark:bg-black/20 bg-black/5 rounded-lg border dark:border-white/5 border-black/5 h-[34px] ml-1">
                <button onClick={() => setMode('ask')} className={cn("px-3 h-full rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer", mode === 'ask' ? "bg-white dark:bg-[#333] text-black dark:text-white shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                  <Search className="w-3.5 h-3.5" /> Ask
                </button>
                <div className="w-px h-3 dark:bg-white/10 bg-black/10 mx-0.5" />
                <button onClick={() => setMode('research')} className={cn("px-3 h-full rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer", mode === 'research' ? "bg-white dark:bg-[#333] text-black dark:text-white shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                  <FlaskConical className="w-3.5 h-3.5" /> Deep Research
                </button>
              </div>
            </div>

            <motion.button onClick={handleSendMessage} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} disabled={isTyping || !value.trim()} className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50", value.trim() ? "dark:bg-white bg-black dark:text-[#0A0A0B] text-white shadow-lg" : "dark:bg-white/5 bg-black/5 text-muted-foreground")}>
              {isTyping ? <LoaderIcon className="w-4 h-4 animate-[spin_2s_linear_infinite]" /> : <SendIcon className="w-4 h-4" />}
              <span>Send</span>
            </motion.button>
          </div>
        </motion.div>

      </div>
    </div>
  )
}