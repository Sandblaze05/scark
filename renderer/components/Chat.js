'use client'

import React, { useRef, useState, useCallback, useEffect } from 'react'
import gsap from 'gsap'
import { ArrowUp, Paperclip, Square, Search, FlaskConical } from 'lucide-react'

const Chat = () => {
  const textareaRef = useRef(null)
  const messagesEndRef = useRef(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [sources, setSources] = useState([])
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState('ask') // 'ask' or 'research'
  const MAX_HEIGHT = 200

  // Auto-scroll to bottom on new content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Register IPC streaming listeners
  useEffect(() => {
    if (typeof window === 'undefined' || !window.scark?.chat) return

    const removeToken = window.scark.chat.onToken((token) => {
      setStreamingContent(prev => prev + token)
    })

    const removeDone = window.scark.chat.onDone(() => {
      setStreamingContent(prev => {
        if (prev) {
          setMessages(msgs => [...msgs, { role: 'assistant', content: prev }])
        }
        return ''
      })
      setIsStreaming(false)
    })

    const removeError = window.scark.chat.onError((error) => {
      setMessages(msgs => [...msgs, { role: 'assistant', content: `Error: ${error}` }])
      setStreamingContent('')
      setStatus('')
      setIsStreaming(false)
    })

    const removeStatus = window.scark.chat.onStatus((text) => {
      setStatus(text)
    })

    return () => {
      removeToken()
      removeDone()
      removeError()
      removeStatus()
    }
  }, [])

  const handleInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    const currentHeight = el.offsetHeight
    el.style.height = 'auto'
    const newHeight = Math.min(el.scrollHeight, MAX_HEIGHT)
    el.style.height = `${currentHeight}px`

    gsap.killTweensOf(el)
    gsap.to(el, { height: newHeight, duration: 0.2, ease: 'power2.out' })
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden'
  }, [])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    if (!window.scark?.chat) return

    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]

    setMessages(newMessages)
    setInput('')
    setIsStreaming(true)
    setStreamingContent('')
    setSources([])

    // Reset textarea height
    if (textareaRef.current) {
      gsap.to(textareaRef.current, { height: 40, duration: 0.2, ease: 'power2.out' })
    }

    try {
      const result = await window.scark.chat.send({ messages: newMessages, topK: 5, mode })
      if (result?.sources?.length > 0) {
        setSources(result.sources)
      }
    } catch (err) {
      setMessages(msgs => [...msgs, { role: 'assistant', content: `Error: ${err.message}` }])
      setIsStreaming(false)
    }
  }, [input, messages, isStreaming, mode])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div className="flex flex-col w-full flex-1 min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-4 space-y-4 scroll-smooth">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <p className="text-center text-sm">
              {mode === 'research'
                ? 'Deep Research — crawls and indexes the web for thorough answers.'
                : 'Ask anything — uses existing knowledge and LLM for quick answers.'}
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl whitespace-pre-wrap text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-white/10 text-white'
                : 'text-gray-200'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}

        {isStreaming && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[75%] px-4 py-2.5 rounded-2xl text-gray-200 whitespace-pre-wrap text-sm leading-relaxed">
              {streamingContent}
              <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-text-bottom" />
            </div>
          </div>
        )}

        {isStreaming && !streamingContent && (
          <div className="flex justify-start">
            <div className="px-4 py-2.5 text-gray-500 text-sm">
              <span className="animate-pulse">{status || 'Thinking…'}</span>
            </div>
          </div>
        )}

        {sources.length > 0 && !isStreaming && (
          <div className="flex justify-start">
            <div className="max-w-[75%] px-4 py-2 text-xs text-gray-500 space-y-1">
              <p className="font-medium text-gray-400">Sources:</p>
              {sources.map((s, i) => (
                <p key={i} className="truncate">{i + 1}. {s.title || s.url}</p>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-1 pb-5">
        <div className="grid grid-rows-[auto_auto] grid-cols-1 py-5 px-7 max-w-2xl outline outline-white/20 rounded-4xl mx-auto bg-linear-270 from-[#38353c]/30 to-[#5a5561]/30">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={mode === 'research' ? "Deep research — crawls the web for answers..." : "Ask anything..."}
            className="mx-auto w-full resize-none overflow-hidden bg-transparent outline-none scroll-smooth leading-5"
            style={{ minHeight: '2.5rem' }}
            disabled={isStreaming}
          />
          <div className="h-10 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Paperclip className="text-gray-500 w-5 h-5" />
              <button
                onClick={() => setMode(m => m === 'ask' ? 'research' : 'ask')}
                disabled={isStreaming}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  mode === 'research'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                }`}
                title={mode === 'research' ? 'Deep Research: crawls the web for thorough answers' : 'Ask: quick answers from existing data + LLM'}
              >
                {mode === 'research'
                  ? <><FlaskConical className="w-3.5 h-3.5" /> Deep Research</>
                  : <><Search className="w-3.5 h-3.5" /> Ask</>
                }
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              className="p-1 bg-white/20 rounded-lg disabled:opacity-40 cursor-pointer transition-opacity"
            >
              {isStreaming
                ? <Square className="text-black w-5 h-5" />
                : <ArrowUp className="text-black w-5 h-5" />
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Chat