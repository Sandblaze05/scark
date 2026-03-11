'use client'
import React, { useState, useEffect, useRef } from 'react'
import Chat from './Chat'
import { ChevronDown, Pin, PinOff, Pencil, Trash2 } from 'lucide-react'

const ChatArea = () => {
  const [chatInfo, setChatInfo] = useState({ chatId: null, messageCount: 0, title: 'New chat', isPinned: false })
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitleValue, setEditingTitleValue] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const titleInputRef = useRef(null)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handleChatChanged = (e) => setChatInfo(prev => ({ ...prev, ...e.detail }))
    window.addEventListener('scark:activeChatChanged', handleChatChanged)

    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      window.removeEventListener('scark:activeChatChanged', handleChatChanged)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const hasMessages = chatInfo.messageCount > 0

  const handleStartEditing = () => {
    setEditingTitleValue(chatInfo.title || '')
    setIsEditingTitle(true)
    setShowDropdown(false)
    setTimeout(() => titleInputRef.current?.focus(), 0)
  }

  const handleSaveTitle = async () => {
    if (chatInfo.chatId && editingTitleValue.trim()) {
      const newTitle = editingTitleValue.trim()
      await window.scark?.chat?.rename?.(chatInfo.chatId, newTitle)
      // Update local chatInfo immediately so the pill doesn't revert
      setChatInfo(prev => ({ ...prev, title: newTitle }))
      // Tell Chat.js to sync its activeChatTitle state right away
      window.dispatchEvent(new CustomEvent('scark:chatTitleOverride', {
        detail: { chatId: chatInfo.chatId, title: newTitle }
      }))
    }
    setIsEditingTitle(false)
  }

  const handleTitleKeyDown = (e) => {
    if (e.key === 'Enter') handleSaveTitle()
    if (e.key === 'Escape') setIsEditingTitle(false)
  }

  const handlePin = async () => {
    if (chatInfo.chatId) {
      await window.scark?.chat?.pin?.(chatInfo.chatId, !chatInfo.isPinned)
      setChatInfo(prev => ({ ...prev, isPinned: !prev.isPinned }))
    }
    setShowDropdown(false)
  }

  const handleDelete = async () => {
    if (chatInfo.chatId) {
      await window.scark?.chat?.remove?.(chatInfo.chatId)
    }
    setShowDropdown(false)
  }

  return (
    <div className="flex flex-1 flex-col pt-2 h-full gap-0 overflow-x-hidden w-full">
      {/* Header: pill appears only after first message is sent, left-aligned */}
      <header className='flex items-center w-full px-5 py-2 min-h-[52px]'>
        {hasMessages && (
          <div className="relative" ref={dropdownRef}>
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                type="text"
                value={editingTitleValue}
                onChange={(e) => setEditingTitleValue(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={handleTitleKeyDown}
                className="
                  bg-zinc-100 dark:bg-[#2f2f2f]
                  text-gray-900 dark:text-white
                  text-sm font-medium px-4 py-2 rounded-full outline-none w-72
                  ring-2 ring-violet-500/40
                  border border-zinc-300 dark:border-transparent
                "
              />
            ) : (
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="
                  flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full
                  transition-colors max-w-xs shadow-sm
                  bg-white dark:bg-[#2f2f2f]
                  text-gray-800 dark:text-white
                  border border-zinc-300 dark:border-white/10
                  hover:bg-zinc-100 dark:hover:bg-[#3a3a3a]
                "
              >
                {chatInfo.isPinned && <Pin size={12} className="shrink-0 opacity-50" />}
                <span className="truncate max-w-[260px]">{chatInfo.title || 'New chat'}</span>
                <ChevronDown size={14} className="shrink-0 opacity-50" />
              </button>
            )}

            {showDropdown && (
              <div className="absolute top-full left-0 mt-2 w-52 bg-white dark:bg-[#2f2f2f] border border-zinc-200 dark:border-white/10 rounded-xl shadow-2xl py-1.5 z-50">
                <button
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-zinc-100 dark:hover:bg-[#3a3a3a] transition-colors text-gray-700 dark:text-gray-200"
                  onClick={handlePin}
                >
                  {chatInfo.isPinned
                    ? <><PinOff size={14} className="opacity-70" /> Unpin</>
                    : <><Pin size={14} className="opacity-70" /> Pin</>
                  }
                </button>
                <button
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-zinc-100 dark:hover:bg-[#3a3a3a] transition-colors text-gray-700 dark:text-gray-200"
                  onClick={handleStartEditing}
                >
                  <Pencil size={14} className="opacity-70" /> Rename
                </button>
                <div className="h-px bg-zinc-200 dark:bg-white/10 my-1 mx-3" />
                <button
                  className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-red-50 dark:hover:bg-[#3a3a3a] text-red-500 dark:text-red-400 transition-colors"
                  onClick={handleDelete}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      <Chat />
    </div>
  )
}

export default ChatArea